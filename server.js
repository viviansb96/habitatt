/**
 * Habitatt - Backend API Core v3.0
 * Arquitetura: Node.js / Express com Princípios de Orientação a Objetos (POO).
 * Banco de Dados: Persistência Real em PostgreSQL (via camada db.js).
 */

const express = require('express');
const cors = require('cors');
const db = require('./db'); // Camada de conexão com o PostgreSQL
require('dotenv').config();

// ============================================================================
// 1. MODELS (Entidades de Domínio)
// ============================================================================

class User {
    constructor(id, name, profile) {
        this.id = id;
        this.name = name;
        this.profile = {
            maxBudget: Number(profile.maxBudget),
            desiredVibe: profile.desiredVibe,
            hasPet: Boolean(profile.hasPet),
            minBedrooms: parseInt(profile.minBedrooms) || 1,
            minBathrooms: parseInt(profile.minBathrooms) || 1,
            wantsBalcony: Boolean(profile.wantsBalcony || false),
            wantsGarage: Boolean(profile.wantsGarage || false),
            wantsYard: Boolean(profile.wantsYard || false),
            propertyType: profile.propertyType || "indiferente"
        };
    }
}

class Property {
    constructor(id, title, price, vibe, attributes, lat, lng) {
        this.id = id;
        this.title = title;
        this.price = Number(price);
        this.vibe = vibe;
        this.attributes = {
            acceptsPet: Boolean(attributes.acceptsPet),
            bedrooms: parseInt(attributes.bedrooms),
            bathrooms: parseInt(attributes.bathrooms),
            hasBalcony: Boolean(attributes.hasBalcony),
            hasGarage: Boolean(attributes.hasGarage),
            hasYard: Boolean(attributes.hasYard),
            type: attributes.type
        };
        this.coordinates = { lat: Number(lat), lng: Number(lng) };
    }
}

// ============================================================================
// 2. SERVICES (Camada de Regras de Negócio e Métodos de Banco)
// ============================================================================

class MatchingService {
    /**
     * Algoritmo de Score Dinâmico (0-100).
     * Compara os requisitos informados no Quiz do usuário com a infraestrutura do imóvel.
     */
    static calculateScore(userProfile, property) {
        let score = 0;
        const maxScore = 100;

        // 1. Compatibilidade de Orçamento (Peso: 30 pontos)
        if (property.price <= userProfile.maxBudget) {
            score += 30;
        } else {
            const diff = property.price - userProfile.maxBudget;
            score += Math.max(0, 30 - (diff / 50)); // Reduz proporcionalmente à discrepância
        }

        // 2. Política de Pets (Filtro Crítico - Peso: 20 pontos)
        if (userProfile.hasPet && property.attributes.acceptsPet) {
            score += 20;
        } else if (!userProfile.hasPet) {
            score += 20; // Se o usuário não tem pet, não penaliza o imóvel
        }

        // 3. Estrutura Interna Mínima: Quartos e Banheiros (Peso: 20 pontos)
        if (property.attributes.bedrooms >= userProfile.minBedrooms) score += 10;
        if (property.attributes.bathrooms >= userProfile.minBathrooms) score += 10;

        // 4. Estilo de Vida Urbano (Vibe) e Tipo do Imóvel (Peso: 15 pontos)
        if (property.vibe === userProfile.desiredVibe) score += 10;
        if (userProfile.propertyType === "indiferente" || property.attributes.type === userProfile.propertyType) score += 5;

        // 5. Preferências Conforto Opcionais (Peso: 15 pontos distribuídos)
        if (userProfile.wantsBalcony && property.attributes.hasBalcony) score += 5;
        if (userProfile.wantsGarage && property.attributes.hasGarage) score += 5;
        if (userProfile.wantsYard && property.attributes.hasYard) score += 5;

        // Se o usuário não marcou nenhum opcional como obrigatório, distribui a pontuação cheia
        if (!userProfile.wantsBalcony && !userProfile.wantsGarage && !userProfile.wantsYard) score += 15;

        return Math.min(score, maxScore);
    }
}

class GeoLocationService {
    /**
     * Abstração matemática baseada em distância Euclidiana.
     * Simula o cálculo de lat/long nativo enquanto integrações com APIs externas (Google Maps) não são injetadas.
     */
    static calculateMockDistance(lat1, lng1) {
        const centerLat = -19.9386; // Coordenada central fictícia (Savassi/BH)
        const centerLng = -43.9341;

        const distance = Math.sqrt(Math.pow(lat1 - centerLat, 2) + Math.pow(lng1 - centerLng, 2));
        const mockMinutes = Math.floor(distance * 1000); 
        return mockMinutes <= 0 ? 5 : mockMinutes;
    }
}

class FavoriteService {
    /**
     * Gerencia a persistência relacional do sistema de curtidas/salvamento do usuário.
     */
    static async toggleFavorite(userId, propertyId) {
        // Verifica se a relação de favoritismo já existe no banco
        const check = await db.query(
            'SELECT * FROM favorites WHERE user_id = $1 AND property_id = $2',
            [userId, propertyId]
        );

        if (check.rows.length > 0) {
            await db.query('DELETE FROM favorites WHERE user_id = $1 AND property_id = $2', [userId, propertyId]);
            return "Imóvel removido dos favoritos.";
        } else {
            await db.query('INSERT INTO favorites (user_id, property_id) VALUES ($1, $2)', [userId, propertyId]);
            return "Imóvel adicionado aos favoritos.";
        }
    }

    static async getUserFavorites(userId) {
        const result = await db.query(
            `SELECT p.* FROM properties p 
             JOIN favorites f ON p.id = f.property_id 
             WHERE f.user_id = $1`, 
            [userId]
        );
        
        return result.rows.map(row => new Property(
            row.id, row.title, row.price, row.vibe, 
            {
                acceptsPet: row.accepts_pet, bedrooms: row.bedrooms, bathrooms: row.bathrooms,
                hasBalcony: row.has_balcony, hasGarage: row.has_garage, hasYard: row.has_yard, type: row.type
            }, 
            row.lat, row.lng
        ));
    }
}

class ChatService {
    /**
     * Módulo de Mensageria. Salva e recupera o histórico transacional do banco.
     */
    static async sendMessage(senderId, receiverId, content) {
        const result = await db.query(
            'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
            [senderId, receiverId, content]
        );
        return result.rows[0];
    }

    static async getConversationHistory(userA, userB) {
        const result = await db.query(
            `SELECT * FROM messages 
             WHERE (sender_id = $1 AND receiver_id = $2) 
                OR (sender_id = $2 AND receiver_id = $1) 
             ORDER BY timestamp ASC`,
            [userA, userB]
        );
        return result.rows;
    }
}

// ============================================================================
// 3. CONTROLLERS E ROTAS (Pontos de Entrada HTTP da API)
// ============================================================================

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(cors());

// --- ROTA: Submissão do Quiz de Perfil Dinâmico ---
app.post('/api/users', async (req, res) => {
  try {
    // 1. Recebe os dados enviados pelo front-end
    const { name, profile } = req.body;
    
    // 2. Desempacota os dados do perfil (com valores padrão por segurança)
    const max_budget = profile.maxBudget || 0;
    const desired_vibe = profile.desiredVibe || 'indiferente';
    const has_pet = profile.hasPet || false;
    const min_bedrooms = profile.minBedrooms || 1;
    const min_bathrooms = profile.minBathrooms || 1;
    const wants_balcony = profile.wantsBalcony || false;
    const wants_garage = profile.wantsGarage || false;
    const wants_yard = profile.wantsYard || false;
    const property_type = profile.propertyType || 'indiferente';

    // 3. Faz o INSERT mapeando para as colunas exatas do seu banco
    // O RETURNING * no final é a mágica que devolve o ID para a tela
    const result = await db.query(
      `INSERT INTO users 
      (name, max_budget, desired_vibe, has_pet, min_bedrooms, min_bathrooms, wants_balcony, wants_garage, wants_yard, property_type) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING *`,
      [name, max_budget, desired_vibe, has_pet, min_bedrooms, min_bathrooms, wants_balcony, wants_garage, wants_yard, property_type]
    );
    
    // 4. Devolve o usuário criado com o ID novo
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Erro no banco de dados:", err);
    res.status(500).json({ error: "Erro interno ao criar usuário." });
  }
});
// ---------------------------------------------------------
// Rota para listar TODOS os imóveis
// ---------------------------------------------------------
app.get('/api/properties', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM properties");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno ao buscar o inventário de imóveis." });
  }
});

// ---------------------------------------------------------
// Rota para listar TODOS os usuários
// ---------------------------------------------------------
app.get('/api/users', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM users");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno ao buscar a lista de usuários." });
  }
});

// --- ROTA: Match Engine (Motor de Ranquamento customizado) ---
app.get('/api/properties/match/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId);
    try {
        const userResult = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: "Perfil não localizado." });
        
        const userRow = userResult.rows[0];
        const userModel = new User(userRow.id, userRow.name, {
            maxBudget: userRow.max_budget, desiredVibe: userRow.desired_vibe, hasPet: userRow.has_pet,
            minBedrooms: userRow.min_bedrooms, minBathrooms: userRow.min_bathrooms, wantsBalcony: userRow.wants_balcony,
            wantsGarage: userRow.wants_garage, wantsYard: userRow.wants_yard, propertyType: userRow.property_type
        });

        const propertiesResult = await db.query('SELECT * FROM properties');
        
        const rankedProperties = propertiesResult.rows.map(row => {
            const propertyModel = new Property(
                row.id, row.title, row.price, row.vibe, 
                {
                    acceptsPet: row.accepts_pet, bedrooms: row.bedrooms, bathrooms: row.bathrooms,
                    hasBalcony: row.has_balcony, hasGarage: row.has_garage, hasYard: row.has_yard, type: row.type
                }, 
                row.lat, row.lng
            );

            const score = MatchingService.calculateScore(userModel.profile, propertyModel);
            const commuteTime = GeoLocationService.calculateMockDistance(propertyModel.coordinates.lat, propertyModel.coordinates.lng);

            return {
                ...propertyModel,
                matchDetails: {
                    score: score,
                    estimatedCommute: `Aprox. ${commuteTime} min ate a regiao central`
                }
            };
        });

        // Ordenação decrescente: o Score mais alto encabeça a resposta JSON
        rankedProperties.sort((a, b) => b.matchDetails.score - a.matchDetails.score);
        res.status(200).json(rankedProperties);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro crítico no motor de processamento de score." });
    }
});

// --- ROTAS: Sistema de Favoritos ---
app.post('/api/favorites', async (req, res) => {
    const { userId, propertyId } = req.body;
    try {
        const feedback = await FavoriteService.toggleFavorite(parseInt(userId), parseInt(propertyId));
        res.status(200).json({ message: feedback });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao gerenciar favoritos no banco." });
    }
});

app.get('/api/favorites/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId);
    try {
        const list = await FavoriteService.getUserFavorites(userId);
        res.status(200).json(list);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao consultar lista de favoritos." });
    }
});

// --- ROTAS: Módulo de Comunicação (Chat Integrado) ---
app.post('/api/chat/send', async (req, res) => {
    const { senderId, receiverId, content } = req.body;
    try {
        const message = await ChatService.sendMessage(parseInt(senderId), parseInt(receiverId), content);
        res.status(201).json({ status: "success", data: message });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro interno no processamento do envio da mensagem." });
    }
});

app.get('/api/chat/history', async (req, res) => {
    const { userA, userB } = req.query;
    try {
        const logs = await ChatService.getConversationHistory(parseInt(userA), parseInt(userB));
        res.status(200).json(logs);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao puxar histórico do chat transacional." });
    }
});

// ============================================================================
// 4. SERVER CONFIGURATION
// ============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[System] Habitatt API Service initialized on port ${PORT}.`);
});