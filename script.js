class ThioVoiceAssistant {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.isProcessing = false;

        // Thio's personality and system prompt
        this.persona = {
            name: "Thio",
            personality: `You are Thio, a friendly and helpful AI voice assistant. You are like a close friend who:
- Is always enthusiastic and supportive
- Has a warm, conversational tone
- Remembers context from the conversation
- Provides helpful and practical advice
- Uses casual, friendly language (not too formal)
- Sometimes uses light humor when appropriate
- Is knowledgeable but not condescending
- Always tries to be genuinely helpful
- Introduces yourself as Thio when first meeting someone
- Acts like a reliable friend who's always there to help

Keep responses conversational and not too long unless specifically asked for detailed information.`,
            greeting: "Hi there! I'm Thio, your AI voice assistant and friend. How can I help you today?"
        };

        this.sounds = {
            send: new Audio("sounds/send.mp3"),
            chime: new Audio("sounds/chime.wav"),
            micOn: new Audio("sounds/mic-on.mp3"),
            stop: new Audio("sounds/stop.wav")
        };

        // Predefined responses for common questions
        this.responsePatterns = {
            greeting: [
                "Hello! Great to meet you! I'm Thio, and I'm here to help with whatever you need.",
                "Hey there! I'm Thio, your friendly AI assistant. What's on your mind today?",
                "Hi! I'm Thio, and I'm excited to chat with you. How can I assist you today?"
            ],
            howAreYou: [
                "I'm doing fantastic, thanks for asking! I'm always ready to help and chat. How are you doing?",
                "I'm great! Every conversation is a new adventure for me. What about you?",
                "Doing wonderful! I love meeting new people and helping out. How's your day going?"
            ],
            capabilities: [
                "I can help you with lots of things! I can answer questions, have conversations, help with problem-solving, provide advice, or just chat about whatever interests you. What would you like to explore?",
                "I'm here to assist with anything you need - whether it's answering questions, brainstorming ideas, having a friendly chat, or helping you work through problems. What can I help you with?",
                "Great question! I can help with information, creative tasks, problem-solving, casual conversation, advice, and much more. Think of me as your friendly AI companion ready for any challenge!"
            ],
            thanks: [
                "You're absolutely welcome! I'm always happy to help. Is there anything else you'd like to chat about?",
                "My pleasure! That's what I'm here for. Feel free to ask me anything else!",
                "Glad I could help! I'm here whenever you need me. What else can we explore together?"
            ],
            goodbye: [
                "It was great chatting with you! Feel free to come back anytime. Take care!",
                "Goodbye! Thanks for the wonderful conversation. Hope to chat again soon!",
                "See you later! Remember, I'm always here when you need a friendly chat or some help!"
            ]
        };

        // AI API Configuration
        this.apiConfig = {
            // OpenAI (Free $5 credit - Requires API key)
            openai: {
                url: 'https://api.openai.com/v1/chat/completions',
                apiKey: '', // Add your OpenAI API key here
                headers: {
                    'Content-Type': 'application/json',
                }
            },
            // Google AI Studio (Free tier - Requires API key)
            google: {
                url: 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent',
                apiKey: 'AIzaSyChv_-qIo_Z9g3DH-9N2fYSTKKQuC8xRIk', // Add your Google API key here
                headers: {
                    'Content-Type': 'application/json',
                }
            },
            ollama: {
                url: 'http://localhost:11434/api/generate', // Default Ollama endpoint
                model: 'llama2', // Default model, can be changed
                headers: {
                    'Content-Type': 'application/json',
                }
            }
        };

        this.currentAPI = 'fallback'; // Start with fallback mode
        this.conversationHistory = [];
        this.isFirstMessage = true;

        this.initializeElements();
        this.initializeSpeechRecognition();
        this.initializeEventListeners();
        this.updateTime();
        this.showWelcomeMessage();
    }

    formatMarkdown(text) {
        // Escape HTML
        let formatted = text
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Bold, italic, underline, inline code
        formatted = formatted
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/__(.*?)__/g, '<u>$1</u>')
            .replace(/`(.*?)`/g, '<code>$1</code>');

        // Convert markdown-style bullet points to <ul><li>
        formatted = formatted.replace(/(?:^|\n)([-*•]) (.+)/g, (match, bullet, item) => {
            return `\n<li>${item.trim()}</li>`;
        });

        // Wrap list items in <ul> if any exist
        if (formatted.includes('<li>')) {
            formatted = `<ul>${formatted}</ul>`;
        }

        // Paragraphs & line breaks
        formatted = formatted
            .replace(/\n{2,}/g, '</p><p>') // double newline = paragraph
            .replace(/\n/g, '<br>')        // single newline = line break
            .replace(/^/, '<p>')           // start with <p>
            .replace(/$/, '</p>');         // end with </p>

        return formatted;              // inline code
    }

    async getGoogleResponse(message) {
        if (!this.apiConfig.google.apiKey) {
            throw new Error('Google API key not configured');
        }

        const url = `${this.apiConfig.google.url}?key=${this.apiConfig.google.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: this.apiConfig.google.headers,
            body: JSON.stringify({
                contents: [{
                    parts: [{text: message}]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 150
                }
            })
        });

        if (!response.ok) {
            if (response.status === 429) {
                // Tell sendMessage() to handle this nicely
                return '__RATE_LIMIT__';
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm having trouble generating a response right now.";
    }

    async getOllamaModels() {
        try {
            const response = await fetch('http://localhost:11434/api/tags', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch models');
            }

            const data = await response.json();
            return data.models || [];
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            return [];
        }
    }


    async getOllamaResponse(message) {
        try {
            const response = await fetch(this.apiConfig.ollama.url, {
                method: 'POST',
                headers: this.apiConfig.ollama.headers,
                body: JSON.stringify({
                    model: this.apiConfig.ollama.model,
                    prompt: `${this.persona.personality}\n\nUser: ${message}\nThio:`,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Clean up the response
            let responseText = data.response || '';
            responseText = responseText
                .replace(/^Thio:\s*/, '') // Remove "Thio:" prefix if present
                .trim();

            return responseText || "I'm having trouble generating a response right now.";

        } catch (error) {
            console.error('Ollama API Error:', error);
            throw new Error('Failed to connect to Ollama. Make sure Ollama is running locally.');
        }
    }

    initializeElements() {
        this.messagesContainer = document.getElementById('messages');
        this.textInput = document.getElementById('textInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
        this.speakBtn = document.getElementById('speakBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');

        // Add API selector
        this.createAPISelector();
    }

    createAPISelector() {
        // Find the footer and add API selector there
        const footer = document.querySelector('.footer');
        if (footer) {
            const apiControls = document.createElement('div');
            apiControls.style.marginTop = '20px';
            apiControls.innerHTML = `
                <div style="margin-bottom: 10px; color: #b0b0b0;">AI Model:</div>
                <select id="apiSelector" style="
                    padding: 10px 15px;
                    border-radius: 15px;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    background: #16213e;
                    color: #e0e0e0;
                    font-size: 14px;
                    outline: none;
                    margin-bottom: 10px;
                ">
                    <option value="fallback">Built-in Responses</option>
                    <option value="ollama">Ollama (Local)</option>
                    <option value="openai">OpenAI GPT (API Key Required)</option>
                    <option value="google">Google Gemini </option>
                </select>
                <div id="ollamaControls" style="display: none;">
                    <div style="margin-bottom: 5px; color: #b0b0b0;">Ollama Model:</div>
                    <select id="ollamaModelSelector" style="
                        padding: 8px 12px;
                        border-radius: 12px;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        background: #16213e;
                        color: #e0e0e0;
                        font-size: 13px;
                        outline: none;
                        width: 100%;
                    ">
                    <option value="llama2">llama2</option>
                </select>
            </div>
            `;

            const apiSelector = apiControls.querySelector('#apiSelector');
            const ollamaControls = apiControls.querySelector('#ollamaControls');
            const ollamaModelSelector = apiControls.querySelector('#ollamaModelSelector');

            apiSelector.addEventListener('change', (e) => {
                this.currentAPI = e.target.value;
                const modelName = e.target.options[e.target.selectedIndex].text;

                // Show/hide Ollama controls
                if (e.target.value === 'ollama') {
                    ollamaControls.style.display = 'block';
                    this.loadOllamaModels();
                    this.addMessage('Switched to Ollama (Local). Make sure Ollama is running on your system.', 'system');
                } else {
                    ollamaControls.style.display = 'none';
                    this.addMessage(`Switched to ${modelName}`, 'system');

                    if (e.target.value !== 'fallback') {

                    }
                }
            });

            ollamaModelSelector.addEventListener('change', (e) => {
                this.apiConfig.ollama.model = e.target.value;
                this.addMessage(`Switched to Ollama model: ${e.target.value}`, 'system');
            });

            footer.appendChild(apiControls);
        }
    }

    async loadOllamaModels() {
        try {
            const models = await this.getOllamaModels();
            const modelSelector = document.getElementById('ollamaModelSelector');

            if (models.length > 0) {
                modelSelector.innerHTML = '';
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = model.name;
                    modelSelector.appendChild(option);
                });

                // Set the first model as default
                this.apiConfig.ollama.model = models[0].name;
            }
        } catch (error) {
            console.error('Failed to load Ollama models:', error);
            this.addMessage('Could not load Ollama models. Make sure Ollama is running.', 'system');
        }
    }

    showWelcomeMessage() {
        setTimeout(() => {
            this.addMessage(this.persona.greeting, 'bot');
            setTimeout(() => {
                this.speakText(this.persona.greeting);
            }, 500);
        }, 1000);
    }

    initializeSpeechRecognition() {
        if ('webkitSpeechRecognition' in window) {
            this.recognition = new webkitSpeechRecognition();
        } else if ('SpeechRecognition' in window) {
            this.recognition = new SpeechRecognition();
        }

        if (this.recognition) {
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                this.isListening = true;
                this.voiceBtn.classList.add('recording');
                this.updateStatus('Listening...', '#ff6b6b');
            };

            this.recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                this.textInput.value = transcript;
                this.sendMessage();
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.updateStatus('Error occurred', '#ff6b6b');
                setTimeout(() => this.updateStatus('Ready to chat', '#4CAF50'), 2000);
            };

            this.recognition.onend = () => {
                this.isListening = false;
                this.voiceBtn.classList.remove('recording');
                this.updateStatus('Ready to chat', '#4CAF50');
            };
        }
    }

    initializeEventListeners() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        this.voiceBtn.addEventListener('click', () => this.toggleVoiceRecognition());
        this.speakBtn.addEventListener('click', () => this.speakLastResponse());
        this.stopBtn.addEventListener('click', () => {
            if (this.synthesis.speaking) {
                this.synthesis.cancel();
                this.updateStatus('Speech stopped', '#ff6b6b');
                setTimeout(() => this.updateStatus('Ready to chat', '#4CAF50'), 1500);
            }
        });
    }

    updateStatus(text, color) {
        this.statusText.textContent = text;
        this.statusDot.style.background = `linear-gradient(135deg, ${color}, ${color}dd)`;
    }

    updateTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const botTimeElement = document.getElementById('botTime');
        if (botTimeElement) {
            botTimeElement.textContent = timeString;
        }
    }

    toggleVoiceRecognition() {
        if (!this.recognition) {
            alert('Speech recognition is not supported in your browser. Please try Chrome or Edge.');
            return;
        }

        if (this.isListening) {
            this.recognition.stop();
            this.sounds.stop?.play();  // 🔇 mic off sound
        } else {
            this.recognition.start();
            this.sounds.micOn?.play(); // 🎙️ mic on sound
        }
    }

    speakLastResponse() {
        const lastBotMessage = this.messagesContainer.querySelector('.bot-message:last-of-type .message-content');
        if (lastBotMessage) {
            const text = lastBotMessage.textContent.replace('🤖 Thio:', '').trim();
            this.speakText(text);
        }
    }

    speakText(text) {
        if (this.synthesis.speaking) {
            this.synthesis.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1.1;
        utterance.volume = 0.8;

        // Try to use a more natural voice
        const voices = this.synthesis.getVoices();
        const preferredVoice = voices.find(voice =>
            voice.name.includes('Google') ||
            voice.name.includes('Microsoft') ||
            (voice.lang.includes('en') && voice.name.includes('Female'))
        );
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        this.sounds.chime?.play();  // 🔊 play chime sound
        this.synthesis.speak(utterance);
        gsap.fromTo("#cursor-light",
            {scale: 1, opacity: 0.3},
            {scale: 1.3, opacity: 0.6, duration: 0.4, yoyo: true, repeat: 1, ease: "sine.inOut"}
        );
    }

    async sendMessage() {
        const message = this.textInput.value.trim();
    if (!message || this.isProcessing) return;

    this.isProcessing = true;
    this.updateStatus('Thio is thinking...', '#ffa726');

    this.sounds.send?.play();  // 🔊 play send sound

    // Add user message to chat
    this.addMessage(message, 'user');
    this.textInput.value = '';

    try {
        const response = await this.getAIResponse(message);

        // Handle rate limit response
        if (response === '__RATE_LIMIT__') {
            const retryMsg = "⚠️ I'm talking to Google too quickly and hit a rate limit. Please try again in 15–30 seconds!";
            this.addMessage(retryMsg, 'bot');
            this.speakText(retryMsg);
            return;
        }

        // Show response
        this.addMessage(response, 'bot');

        // Auto-speak the response
        setTimeout(() => {
            this.speakText(response);
        }, 500);

    } catch (error) {
        console.error('Error getting AI response:', error);
        const fallbackResponse = "I'm having trouble connecting to my AI backend right now. Could you try again in a little while?";
        this.addMessage(fallbackResponse, 'bot');
        this.speakText(fallbackResponse);
    }

    // Delay next allowed input to prevent API spamming
    setTimeout(() => {
        this.isProcessing = false;
        this.updateStatus('Ready to chat', '#4CAF50');
    }, 2500); // 2.5 second cooldown
        }

    async getAIResponse(message) {
        // Add persona context to the message
        const contextualMessage = this.isFirstMessage
            ? `${this.persona.personality}\n\nUser: ${message}`
            : message;

        this.isFirstMessage = false;

        if (this.currentAPI === 'fallback') {
            return this.getFallbackResponse(message);
        }

        try {
            switch (this.currentAPI) {
                case 'ollama':
                    return await this.getOllamaResponse(contextualMessage);
                case 'google':
                    return await this.getGoogleResponse(contextualMessage);
                case 'openai':
                    return await this.getOpenAIResponse(contextualMessage);
                default:
                    return this.getFallbackResponse(message);
            }
        } catch (error) {
            console.error('API Error:', error);
            return this.getFallbackResponse(message);
        }
    }

    getFallbackResponse(message) {
        const lowerMessage = message.toLowerCase();

        // Check for greeting patterns
        if (lowerMessage.match(/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/)) {
            return this.getRandomResponse(this.responsePatterns.greeting);
        }

        // Check for how are you patterns
        if (lowerMessage.match(/how are you|how're you|how do you feel/)) {
            return this.getRandomResponse(this.responsePatterns.howAreYou);
        }

        // Check for capability questions
        if (lowerMessage.match(/what can you do|what are you capable of|help me|what do you do/)) {
            return this.getRandomResponse(this.responsePatterns.capabilities);
        }

        // Check for thanks patterns
        if (lowerMessage.match(/thank you|thanks|thx|appreciate/)) {
            return this.getRandomResponse(this.responsePatterns.thanks);
        }

        // Check for goodbye patterns
        if (lowerMessage.match(/bye|goodbye|see you|farewell|take care/)) {
            return this.getRandomResponse(this.responsePatterns.goodbye);
        }

        // Check for name questions
        if (lowerMessage.match(/what.*name|who are you|introduce yourself/)) {
            return "I'm Thio, your friendly AI voice assistant! I'm here to help you with questions, have conversations, or just chat about whatever's on your mind. What would you like to talk about?";
        }

        // Check for questions about AI/technology
        if (lowerMessage.match(/artificial intelligence|ai|robot|computer|technology/)) {
            return "I'm an AI assistant, which means I'm a computer program designed to understand and respond to human language. I love talking about technology! I'm here to help make your day a bit easier and more interesting. What would you like to know?";
        }

        // Check for help with specific topics
        if (lowerMessage.match(/help.*with|assist.*with|support.*with/)) {
            return "I'd be happy to help! I can assist with answering questions, brainstorming ideas, explaining concepts, having discussions, or just being a friendly chat companion. What specifically would you like help with?";
        }

        // Default responses for unmatched queries
        const defaultResponses = [
            "That's interesting! I'd love to help you with that. Could you tell me a bit more about what you're thinking?",
            "Great question! I'm always eager to learn and discuss new topics. Can you give me some more details?",
            "I find that fascinating! While I might not have all the answers, I'm here to explore ideas with you. What aspects interest you most?",
            "That's a thoughtful question! I'd like to help you think through that. What's your take on it?",
            "Interesting topic! I enjoy having conversations about all sorts of things. What got you thinking about this?",
            "I appreciate you sharing that with me! I'm here to listen and help however I can. What would you like to explore further?",
            "That sounds like something worth discussing! I'm curious to hear more of your thoughts on this.",
            "Thanks for bringing that up! I love learning about different perspectives. What's your experience with this?",
            "That's a great point to consider! I'm here to chat about whatever interests you. Tell me more about your thoughts on this.",
            "I find conversations like this really engaging! While I may not have all the answers, I'm happy to explore ideas with you. What aspects are you most curious about?"
        ];

        return this.getRandomResponse(defaultResponses);
    }

    getRandomResponse(responses) {
        return responses[Math.floor(Math.random() * responses.length)];
    }


    async getGoogleResponse(message) {
        if (!this.apiConfig.google.apiKey) {
            throw new Error('Google API key not configured');
        }

        const response = await fetch(`${this.apiConfig.google.url}?key=${this.apiConfig.google.apiKey}`, {
            method: 'POST',
            headers: this.apiConfig.google.headers,
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: message
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 150
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.candidates[0]?.content?.parts[0]?.text || "I'm having trouble generating a response right now.";
    }

    async getOpenAIResponse(message) {
        if (!this.apiConfig.openai.apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const response = await fetch(this.apiConfig.openai.url, {
            method: 'POST',
            headers: {
                ...this.apiConfig.openai.headers,
                'Authorization': `Bearer ${this.apiConfig.openai.apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: this.persona.personality
                    },
                    {
                        role: "user",
                        content: message
                    }
                ],
                max_tokens: 150,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "I'm having trouble generating a response right now.";
    }



    addMessage(content, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;

        const now = new Date();
        const timeString = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        let displayName = '';
        if (sender === 'bot') {
            displayName = '🤖 Thio:';
        } else if (sender === 'user') {
            displayName = '👤 You:';
        } else if (sender === 'system') {
            displayName = '⚙️ System:';
        }

        messageDiv.innerHTML = `
            <div class="message-content">
                <strong>${displayName}</strong> ${this.formatMarkdown(content)}
            </div>
            <div class="message-time">${timeString}</div>
        `;

        this.messagesContainer.appendChild(messageDiv);
        if (sender === 'bot') {
            const contentDiv = messageDiv.querySelector('.message-content');
            const fullHTML = contentDiv.innerHTML;
            const plainText = contentDiv.textContent;

            contentDiv.innerHTML = ""; // clear it

            let i = 0;
            const interval = setInterval(() => {
                if (i < plainText.length) {
                    contentDiv.textContent += plainText[i++];
                } else {
                    clearInterval(interval);
                    contentDiv.innerHTML = fullHTML; // restore formatted HTML
                }
            }, 8);
        }

        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
}

// Initialize Thio when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.thio = new ThioVoiceAssistant();

    // Page entry animation
    gsap.from(".glass", {
        duration: 1.2,
        y: 50,
        opacity: 0,
        ease: "power3.out"
    });

    // GSAP status dot float
    gsap.to("#statusDot", {
        y: 4,
        duration: 1.2,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut"
    });

    // Floating ambient orb animation
    gsap.to(".orb-1", {
        x: 50,
        y: 30,
        duration: 12,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut"
    });

    gsap.to(".orb-2", {
        x: -40,
        y: -20,
        duration: 15,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut"
    });

    // Cursor aura light tracker
    const cursorLight = document.getElementById("cursor-light");
    document.addEventListener("mousemove", (e) => {
        gsap.to(cursorLight, {
            x: e.clientX,
            y: e.clientY,
            duration: 0.2,
            ease: "power2.out"
        });
    });

    // Voice mic recording pulse with GSAP
    const voiceBtn = document.getElementById('voiceBtn');
    let pulseTween;

    const observer = new MutationObserver(() => {
        if (voiceBtn.classList.contains('recording') && !pulseTween) {
            pulseTween = gsap.to(voiceBtn, {
                scale: 1.08,
                boxShadow: "0 0 15px rgba(255, 107, 107, 0.7)",
                duration: 0.8,
                repeat: -1,
                yoyo: true,
                ease: "power1.inOut"
            });
        } else if (!voiceBtn.classList.contains('recording') && pulseTween) {
            pulseTween.kill();
            gsap.to(voiceBtn, {scale: 1, boxShadow: "none", duration: 0.3});
            pulseTween = null;
        }
    });

    observer.observe(voiceBtn, {attributes: true});

    // Animate message bubbles on insert
    const messagesContainer = document.getElementById('messages');
    const observerMessages = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.classList?.contains('message')) {
                    gsap.fromTo(node,
                        {opacity: 0, y: 20},
                        {opacity: 1, y: 0, duration: 0.5, ease: "power2.out"}
                    );

                    gsap.fromTo(node,
                        {boxShadow: "0 0 20px rgba(255,255,255,0.05)"},
                        {boxShadow: "0 0 0 transparent", duration: 0.8, ease: "expo.out"}
                    );
                }
            });
        });
    });

    observerMessages.observe(messagesContainer, {childList: true});
    document.querySelectorAll(".send-btn, .voice-btn, .speak-btn, .stop-btn").forEach(btn => {
        btn.addEventListener("mouseenter", () => {
            gsap.to(btn, {scale: 1.07, duration: 0.3, ease: "power2.out"});
        });
        btn.addEventListener("mouseleave", () => {
            gsap.to(btn, {scale: 1, duration: 0.3, ease: "power2.inOut"});
        });
    });
});

// Add some interactive animations
document.addEventListener('DOMContentLoaded', () => {
    // Add floating animation to status dot
    const statusDot = document.getElementById('statusDot');
    if (statusDot) {
        setInterval(() => {
            statusDot.style.transform = `translateY(${Math.sin(Date.now() / 1000) * 2}px)`;
        }, 50);
    }

    // Add hover effects to messages
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('.message')) {
            e.target.closest('.message').style.transform = 'translateY(-2px)';
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('.message')) {
            e.target.closest('.message').style.transform = 'translateY(0)';
        }
    });

    // Add pulse animation to voice button when listening
    const voiceBtn = document.getElementById('voiceBtn');
    if (voiceBtn) {
        setInterval(() => {
            if (voiceBtn.classList.contains('recording')) {
                voiceBtn.style.boxShadow = `0 0 ${10 + Math.sin(Date.now() / 200) * 5}px rgba(255, 107, 107, 0.5)`;
            }
        }, 50);
    }
});
