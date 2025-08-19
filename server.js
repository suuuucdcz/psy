const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration Hugging Face
const HF_API_TOKEN = process.env.HF_API_TOKEN;
if (!HF_API_TOKEN) {
  console.error('ERROR: HF_API_TOKEN environment variable is not set');
  process.exit(1);
}
const HF_CHAT_MODEL = 'mistralai/Mistral-7B-Instruct-v0.3'; // Modèle conversationnel
const HF_EMOTION_MODEL = 'mistralai/Mistral-7B-Instruct-v0.3'; // Modèle d'analyse d'émotions multilingue

// Stockage des conversations par session
const conversations = new Map();

// Cache pour les émotions (évite de réanalyser les mêmes textes)
const emotionCache = new Map();

// Contexte pour le psychologue
const psychologistContext = `
[ROLE] Psychologue clinicien expérimenté
[MISSION] Soutien émotionnel et bien-être mental
[STYLE] Professionnel, empathique et bienveillant
[DIRECTIVES] 
- Pose des questions ouvertes
- Valide les sentiments
- Encourage l'introspection
- Évite les diagnostics médicaux
- Réponses de 4-7 phrases
- Utilise un langage simple et accessible
- Favorise l'exploration des émotions
- Offre un soutien non-jugeant
`;

// Liste d'exercices thérapeutiques
const exercises = [
  {
    id: 'breathing',
    title: "Respiration profonde",
    description: "Un exercice simple pour réduire le stress et l'anxiété",
    duration: 5,
    steps: [
      "Asseyez-vous confortablement, le dos droit",
      "Inspirez profondément par le nez pendant 4 secondes",
      "Retenez votre respiration pendant 4 secondes",
      "Expirez lentement par la bouche pendant 6 secondes",
      "Répétez ce cycle pendant 5 minutes"
    ]
  },
  {
    id: 'mindfulness',
    title: "Méditation de pleine conscience",
    description: "Concentrez-vous sur le moment présent",
    duration: 10,
    steps: [
      "Trouvez un endroit calme et asseyez-vous confortablement",
      "Fermez les yeux et portez attention à votre respiration",
      "Lorsque des pensées surgissent, reconnaissez-les puis laissez-les partir",
      "Concentrez-vous sur les sensations corporelles",
      "Continuez pendant 10 minutes"
    ]
  },
  {
    id: 'gratitude',
    title: "Journal de gratitude",
    description: "Cultivez une attitude reconnaissante",
    duration: 7,
    steps: [
      "Prenez un carnet et un stylo",
      "Listez 3 choses pour lesquelles vous êtes reconnaissant aujourd'hui",
      "Décrivez pourquoi chacune est importante pour vous",
      "Réfléchissez à la sensation de gratitude",
      "Pratiquez cet exercice quotidiennement"
    ]
  }
];

// Cache simple pour réduire les appels API
const responseCache = new Map();
const CACHE_DURATION = 1000 * 60 * 60; // 1 heure

app.post('/api/chat', async (req, res) => {
  const { prompt, sessionId } = req.body;
  
  try {
    // Vérifier le cache
    const cacheKey = `${sessionId}-${prompt}`;
    const cached = responseCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return res.json({ response: cached.response });
    }
    
    // Créer une clé unique par session
    const conversationKey = `${sessionId}-pro`;
    
    // Initialiser la conversation si nécessaire
    if (!conversations.has(conversationKey)) {
      conversations.set(conversationKey, []);
    }
    
    const history = conversations.get(conversationKey);
    
    // Ajouter le nouveau message à l'historique
    history.push({ role: 'user', content: prompt });
    
    // Construction du prompt contextuel pour Hugging Face
    const contextPrompt = buildContextPrompt(history);
    
    // Appel à l'API Hugging Face avec timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 secondes timeout
    
    try {
      const response = await fetch(
        `https://api-inference.huggingface.co/models/${HF_CHAT_MODEL}`,
        {
          headers: { 
            Authorization: `Bearer ${HF_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          method: 'POST',
          body: JSON.stringify({ 
            inputs: contextPrompt,
            parameters: {
              max_new_tokens: 150,
              temperature: 0.7,
              top_p: 0.9,
              repetition_penalty: 1.2,
              return_full_text: false
            }
          }),
          signal: controller.signal
        }
      );
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        if (response.status === 503) {
          // Modèle en cours de chargement
          return res.json({ 
            response: "Le système est en cours de préparation. Veuillez réessayer dans quelques instants.",
            retry: true
          });
        }
        throw new Error(`Erreur API Hugging Face: ${response.statusText}`);
      }
      
      const data = await response.json();
      let rawResponse = "";
      
      if (Array.isArray(data) && data.length > 0 && data[0].generated_text) {
        rawResponse = data[0].generated_text;
      } else if (data.generated_text) {
        rawResponse = data.generated_text;
      } else {
        rawResponse = "Je n'ai pas pu générer de réponse. Pouvez-vous reformuler?";
      }
      
      // Extraire seulement la dernière réponse
      const aiResponse = extractAIResponse(contextPrompt, rawResponse);
      
      // Post-traitement de la réponse
      const processedResponse = processAIResponse(aiResponse);
      
      // Ajouter la réponse traitée à l'historique
      history.push({ role: 'assistant', content: processedResponse });
      
      // Mettre en cache
      responseCache.set(cacheKey, {
        response: processedResponse,
        timestamp: Date.now()
      });
      
      // Limiter la taille de l'historique
      if (history.length > 20) history.splice(0, history.length - 20);
      
      conversations.set(conversationKey, history);
      
      res.json({ response: processedResponse });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.json({ 
          response: "La réponse met trop de temps à arriver. Veuillez réessayer.",
          timeout: true
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('Erreur API:', err);
    
    // Réponse de secours
    const fallbackResponses = [
      "Je comprends ce que vous ressentez. Pouvez-vous m'en dire plus?",
      "C'est une situation intéressante. Comment vous sentez-vous par rapport à cela?",
      "Merci de partager cela avec moi. Comment cela affecte-t-il votre quotidien?",
      "Je vois. Prenons un moment pour réfléchir à cela ensemble.",
      "Votre bien-être est important. Souhaitez-vous explorer des stratégies pour gérer cette situation?"
    ];
    
    const fallback = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
    
    res.json({ 
      response: fallback,
      error: 'Erreur de traitement',
      fallback: true
    });
  }
});

function buildContextPrompt(history) {
  let prompt = psychologistContext;
  prompt += "\n\n[CONVERSATION]";
  
  // Ajouter l'historique complet de la conversation
  history.forEach(entry => {
    const prefix = entry.role === 'user' ? "Patient" : "Psychologue";
    prompt += `\n${prefix}: ${entry.content}`;
  });
  
  prompt += "\nPsychologue:";
  return prompt;
}

function extractAIResponse(fullPrompt, generatedText) {
  // Supprimer le prompt initial pour ne garder que la réponse générée
  const response = generatedText.replace(fullPrompt, '').trim();
  
  // Nettoyer les répétitions et artefacts
  return response.split('\n')[0].replace(/Patient:.*/i, '').trim();
}

function processAIResponse(text) {
  // Nettoyage de la réponse
  text = text.trim()
    .replace(/\n{2,}/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .replace(/([.!?])(\s|$)/g, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\n\n)$/, '');
  
  // Capitaliser la première lettre
  text = text.charAt(0).toUpperCase() + text.slice(1);
  
  // Supprimer les espaces en début de ligne
  return text.split('\n').map(line => line.trim()).join('\n');
}

app.get('/api/clear/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const conversationKey = `${sessionId}-pro`;
  
  if (conversations.has(conversationKey)) {
    conversations.delete(conversationKey);
    res.json({ success: true, message: 'Conversation effacée' });
  } else {
    res.json({ success: false, message: 'Aucune conversation trouvée' });
  }
});

// Route pour l'analyse des émotions - ADAPTÉE POUR HUGGING FACE
app.post('/api/analyze-emotion', async (req, res) => {
  const { text } = req.body;
  
  if (!text || text.trim().length < 3) {
    return res.json({ emotion: 'neutre' });
  }
  
  // Vérifier le cache d'abord
  const cacheKey = text.toLowerCase().trim();
  if (emotionCache.has(cacheKey)) {
    return res.json({ emotion: emotionCache.get(cacheKey) });
  }
  
  try {
    // Appel à l'API Hugging Face pour l'analyse d'émotion
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${HF_EMOTION_MODEL}`,
      {
        headers: { Authorization: `Bearer ${HF_API_TOKEN}` },
        method: 'POST',
        body: JSON.stringify({ inputs: text }),
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0 && data[0].length > 0) {
        // Le modèle retourne un tableau de résultats avec scores
        const emotions = data[0];
        
        // Trouver l'émotion avec le score le plus élevé
        let topEmotion = 'neutre';
        let topScore = 0;
        
        emotions.forEach(emotion => {
          if (emotion.score > topScore) {
            topScore = emotion.score;
            topEmotion = emotion.label;
          }
        });
        
        // Mapper les émotions en français
        const emotionMap = {
          'joy': 'joie',
          'sadness': 'tristesse', 
          'anger': 'colère',
          'fear': 'peur',
          'surprise': 'surprise',
          'disgust': 'dégoût',
          'neutral': 'neutre'
        };
        
        const finalEmotion = emotionMap[topEmotion] || 'neutre';
        
        // Mettre en cache le résultat
        emotionCache.set(cacheKey, finalEmotion);
        
        return res.json({ emotion: finalEmotion });
      }
    }
    
    // Fallback vers une analyse simple si l'API échoue
    const positiveWords = ['heureux', 'content', 'joyeux', 'satisfait', 'bon', 'bien', 'génial', 'super'];
    const negativeWords = ['triste', 'malheureux', 'déçu', 'colère', 'fâché', 'peur', 'anxieux', 'stressé'];
    
    const lowerText = text.toLowerCase();
    let positiveCount = 0;
    let negativeCount = 0;
    
    positiveWords.forEach(word => {
      if (lowerText.includes(word)) positiveCount++;
    });
    
    negativeWords.forEach(word => {
      if (lowerText.includes(word)) negativeCount++;
    });
    
    let fallbackEmotion = 'neutre';
    if (positiveCount > negativeCount) {
      fallbackEmotion = 'joie';
    } else if (negativeCount > positiveCount) {
      fallbackEmotion = 'tristesse';
    }
    
    // Mettre en cache le résultat de fallback
    emotionCache.set(cacheKey, fallbackEmotion);
    
    res.json({ emotion: fallbackEmotion });
    
  } catch (err) {
    console.error('Erreur analyse émotion:', err);
    res.json({ emotion: 'neutre' });
  }
});

// Route pour les données de progression
app.get('/api/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const conversationKey = `${sessionId}-pro`;
  
  if (!conversations.has(conversationKey)) {
    return res.status(404).json({ error: 'Session non trouvée' });
  }
  
  const history = conversations.get(conversationKey);
  
  // Analyser les émotions dans l'historique
  const emotionCount = {
    joie: 0, tristesse: 0, colère: 0, peur: 0, surprise: 0, dégoût: 0, neutre: 0
  };
  
  const wordFrequency = {};
  
  history.forEach(entry => {
    if (entry.emotion) emotionCount[entry.emotion]++;
    
    // Analyser les mots
    if (entry.role === 'user') {
      const words = entry.content.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (word.length > 3) { // Ignorer les mots courts
          wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        }
      });
    }
  });
  
  // Trouver les mots les plus fréquents
  const sortedWords = Object.entries(wordFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));
  
  res.json({
    emotionDistribution: emotionCount,
    topWords: sortedWords,
    sessionCount: history.filter(e => e.role === 'user').length,
    avgMessageLength: history.reduce((sum, e) => sum + e.content.length, 0) / Math.max(1, history.length)
  });
});

// Route pour obtenir les exercices
app.get('/api/exercises', (req, res) => {
  res.json(exercises);
});

// Middleware pour la gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint non trouvé' });
});

// Middleware pour la gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Nettoyer le cache périodiquement
setInterval(() => {
  const now = Date.now();
  for (let [key, value] of responseCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      responseCache.delete(key);
    }
  }
  
  // Nettoyer aussi le cache d'émotions
  if (emotionCache.size > 1000) {
    const keys = Array.from(emotionCache.keys());
    for (let i = 0; i < 200; i++) {
      emotionCache.delete(keys[i]);
    }
  }
}, 1000 * 60 * 30); // Toutes les 30 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur IA Psychologue démarré sur http://localhost:${PORT}`));