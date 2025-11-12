import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat } from '@google/genai';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface AISettings {
    model: 'gemini-2.5-flash' | 'gemini-2.5-pro';
    systemInstruction?: string;
    temperature?: number;
    topK?: number;
    topP?: number;
    intelligentMode?: 'ahm ai 2.5' | 'ahm ai 5';
    codeIsNonbro?: boolean;
}

// New interface for individual user profiles stored in a global list
interface UserProfile {
    id: string; // Unique ID for each user profile
    username: string;
    isVerified: boolean;
    profilePicture: string | null;
}

// The user context will now store the *currently active* user's profile
// and functions to manipulate the global list of registered users.
interface UserContextType {
    currentUser: UserProfile; // The currently logged-in user's profile or DEFAULT_GUEST_USER_PROFILE
    // Function to set the currently active user profile directly (use with caution)
    setCurrentUser: React.Dispatch<React.SetStateAction<UserProfile>>;
    // List of all registered user profiles
    registeredUsers: UserProfile[];
    // Function to set the list of all registered user profiles directly (use with caution)
    setRegisteredUsers: React.Dispatch<React.SetStateAction<UserProfile[]>>;
    // Convenience functions for user actions
    loginUser: (profile: UserProfile) => void;
    logoutUser: () => void;
    updateUserProfile: (profile: UserProfile) => void; // Updates a profile in registeredUsers and, if it's the current user, updates currentUser
}

const DEFAULT_GUEST_USER_PROFILE: UserProfile = {
    id: 'guest',
    username: 'Guest',
    isVerified: false,
    profilePicture: null,
};

const UserContext = createContext<UserContextType | undefined>(undefined);

const useUser = () => {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
};

const UserProvider = ({ children }: { children: React.ReactNode }) => {
    const [currentUser, setCurrentUser] = useState<UserProfile>(DEFAULT_GUEST_USER_PROFILE);
    const [registeredUsers, setRegisteredUsers] = useState<UserProfile[]>([]);

    // Load all registered users and the last active user on component mount
    useEffect(() => {
        try {
            const savedRegisteredUsers = localStorage.getItem('registeredUsers');
            if (savedRegisteredUsers) {
                const parsedRegisteredUsers: UserProfile[] = JSON.parse(savedRegisteredUsers);
                setRegisteredUsers(parsedRegisteredUsers);

                const lastActiveUserId = localStorage.getItem('lastActiveUserId');
                if (lastActiveUserId) {
                    const activeProfile = parsedRegisteredUsers.find(p => p.id === lastActiveUserId);
                    if (activeProfile) {
                        setCurrentUser(activeProfile);
                        return; // Exit early if active user found
                    }
                }
            }
        } catch (error) {
            console.error("Failed to load user data from localStorage", error);
            // Clear potentially corrupt data
            localStorage.removeItem('registeredUsers'); 
            localStorage.removeItem('lastActiveUserId');
        }
        setCurrentUser(DEFAULT_GUEST_USER_PROFILE); // Ensure guest if nothing loaded
    }, []);

    // Save registered users whenever the list changes
    useEffect(() => {
        try {
            localStorage.setItem('registeredUsers', JSON.stringify(registeredUsers));
        } catch (error) {
            console.error("Failed to save registered users to localStorage", error);
        }
    }, [registeredUsers]);

    // Save current user ID whenever currentUser changes (if not guest)
    useEffect(() => {
        try {
            if (currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id) {
                localStorage.setItem('lastActiveUserId', currentUser.id);
            } else {
                localStorage.removeItem('lastActiveUserId');
            }
        } catch (error) {
            console.error("Failed to save last active user ID to localStorage", error);
        }
    }, [currentUser]);

    const loginUser = (profile: UserProfile) => {
        setCurrentUser(profile);
    };

    const logoutUser = () => {
        setCurrentUser(DEFAULT_GUEST_USER_PROFILE);
    };

    const updateUserProfile = (updatedProfile: UserProfile) => {
        setRegisteredUsers(prev => {
            const existingIndex = prev.findIndex(p => p.id === updatedProfile.id);
            if (existingIndex !== -1) {
                const newUsers = [...prev];
                newUsers[existingIndex] = updatedProfile;
                return newUsers;
            } else {
                // If it's a new profile (e.g., from registration)
                return [...prev, updatedProfile];
            }
        });
        // If the updated profile is the currently active one, update currentUser too
        if (currentUser.id === updatedProfile.id) {
            setCurrentUser(updatedProfile);
        }
    };

    const contextValue = {
        currentUser,
        setCurrentUser,
        registeredUsers,
        setRegisteredUsers,
        loginUser,
        logoutUser,
        updateUserProfile,
    };

    return (
        <UserContext.Provider value={contextValue}>
            {children}
        </UserContext.Provider>
    );
};


interface StoredSession {
    id: string;
    title: string;
    messages: Message[];
    settings: AISettings;
    isPublic: boolean;
    isArchived: boolean; // New property for archiving
}

const DEFAULT_AI_SETTINGS: AISettings = {
    model: 'gemini-2.5-flash',
    systemInstruction: '',
    temperature: 0.9,
    topK: 1,
    topP: 1,
    intelligentMode: 'ahm ai 2.5',
    codeIsNonbro: false,
};

const App = () => {
  const { currentUser, registeredUsers, loginUser, logoutUser, updateUserProfile } = useUser();
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCodeViewVisible, setIsCodeViewVisible] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isLoginRegisterModalOpen, setIsLoginRegisterModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isUserListModalOpen, setIsUserListModalOpen] = useState(false);
  const [publicSessionData, setPublicSessionData] = useState<Pick<StoredSession, 'title' | 'messages'> | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [showArchivedSessions, setShowArchivedSessions] = useState(false); // New state for showing archived sessions
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null); // State for context menu
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const viewData = urlParams.get('view');
    if (viewData) {
        try {
            const decodedData = atob(viewData);
            const parsedData = JSON.parse(decodedData);
            if (parsedData.title && Array.isArray(parsedData.messages)) {
                setPublicSessionData(parsedData);
                return; // Enter public view mode
            }
        } catch (error) {
            console.error("Failed to parse public session data from URL", error);
        }
    }

    // Load settings from localStorage on initial render
    try {
        const savedSettings = localStorage.getItem('aiSettings');
        if (savedSettings) {
            const parsedSettings = JSON.parse(savedSettings);
            setAiSettings({ ...DEFAULT_AI_SETTINGS, ...parsedSettings });
        }
    } catch (error) {
        console.error("Failed to load AI settings from localStorage", error);
    }

    // Load sessions from localStorage on initial render
    try {
        const savedSessions = localStorage.getItem(`chatSessions_${currentUser.id}`); // Load sessions specific to the current user
        if (savedSessions) {
            const parsedSessions = JSON.parse(savedSessions) as StoredSession[];
            const migratedSessions = parsedSessions.map(s => ({
                ...s,
                settings: { ...DEFAULT_AI_SETTINGS, ...(s.settings || {}) },
                isPublic: s.isPublic || false,
                isArchived: s.isArchived || false, // Initialize new property
            }));

            if (migratedSessions.length > 0) {
                setSessions(migratedSessions);
                // Set active session to the first non-archived session, or first archived if no non-archived
                const firstActive = migratedSessions.find(s => !s.isArchived) || migratedSessions[0];
                setActiveSessionId(firstActive.id);
                return;
            }
        }
    } catch (error) {
        console.error("Failed to load sessions from localStorage", error);
        localStorage.removeItem(`chatSessions_${currentUser.id}`); // Clear corrupt data
    }
    handleNewChat(true); // Create a new chat if storage is empty or corrupt
  }, [currentUser.id]); // Reload sessions when currentUser changes

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    if (sessions.length > 0 && !publicSessionData && currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id) {
        try {
            localStorage.setItem(`chatSessions_${currentUser.id}`, JSON.stringify(sessions));
        } catch (error) {
            console.error("Failed to save sessions to localStorage", error);
        }
    } else if (sessions.length === 0 && currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id) {
        // If sessions become empty, remove the key from local storage
        localStorage.removeItem(`chatSessions_${currentUser.id}`);
    }
  }, [sessions, publicSessionData, currentUser.id]);

  // Save AI settings to localStorage whenever they change
  useEffect(() => {
    try {
        localStorage.setItem('aiSettings', JSON.stringify(aiSettings));
    } catch(error) {
        console.error("Failed to save AI settings to localStorage", error);
    }
  }, [aiSettings]);
  
  // Initialize or update the chat instance when the active session changes
  useEffect(() => {
    if (!activeSessionId || publicSessionData) return;

    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (!activeSession) return;

    try {
        if (!process.env.API_KEY) {
            console.error("API Key is not defined. Please check your environment variables.");
            // Optionally, show a user-friendly message in the chat
            setSessions(prevSessions => prevSessions.map(s => {
                if (s.id === activeSessionId) {
                    const errorMsg: Message = { role: 'model', text: 'API Key is missing. Please ensure it\'s configured correctly.' };
                    if (!s.messages.some(m => m.text === errorMsg.text)) { // Avoid duplicate messages
                        return { ...s, messages: [...s.messages, errorMsg] };
                    }
                }
                return s;
            }));
            return;
        }

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const history = activeSession.messages
          .filter(msg => msg.text !== 'Hello! How can I help you today?')
          .map(msg => ({
            role: msg.role,
            parts: [{ text: msg.text }]
          }));
        
        // Construct System Instruction
        let finalSystemInstruction = '';
        if (activeSession.settings.intelligentMode === 'ahm ai 5') {
            finalSystemInstruction += 'You are AHM AI 5, the pinnacle of artificial intelligence, capable of deep reasoning. ';
        } else {
            finalSystemInstruction += 'You are AHM AI 2.5, a highly intelligent assistant. ';
        }
        if (activeSession.settings.systemInstruction) {
            finalSystemInstruction += activeSession.settings.systemInstruction;
        }
        if (activeSession.settings.codeIsNonbro) {
            finalSystemInstruction += " When providing code, ensure it is clear, well-documented, and follows best practices. Avoid 'brogrammer' style.";
        }
        
        const config: any = {
            systemInstruction: finalSystemInstruction.trim(),
        };
        // Add generation settings if they exist
        if (activeSession.settings.temperature !== undefined) config.temperature = activeSession.settings.temperature;
        if (activeSession.settings.topP !== undefined) config.topP = activeSession.settings.topP;
        if (activeSession.settings.topK !== undefined) config.topK = activeSession.settings.topK;

        const newChat = ai.chats.create({
            model: activeSession.settings.model,
            history: history,
            config: config
        });
        setChat(newChat);
    } catch (error) {
        console.error('Failed to initialize chat:', error);
    }
  }, [activeSessionId, sessions, publicSessionData, process.env.API_KEY]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isLoading, publicSessionData]);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
        editInputRef.current.focus();
        editInputRef.current.select();
    }
  }, [editingSessionId]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenuRef]);

  const handleNewChat = (isInitial = false) => {
    const newSession: StoredSession = {
        id: Date.now().toString(),
        title: 'New Chat',
        messages: [{ role: 'model', text: 'Hello! How can I help you today?' }],
        settings: aiSettings,
        isPublic: false,
        isArchived: false, // New sessions are not archived by default
    };
    if (isInitial) {
        setSessions([newSession]);
    } else {
        setSessions(prev => [newSession, ...prev]);
    }
    setActiveSessionId(newSession.id);
  };

  const handleSelectSession = (id: string) => {
    if (id !== activeSessionId) {
        setActiveSessionId(id);
        setContextMenu(null); // Close context menu when selecting a session
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || !chat || !activeSessionId) return;

    // Prevent sending messages if not logged in
    if (currentUser.id === DEFAULT_GUEST_USER_PROFILE.id) {
        alert('Please log in or register to send messages.');
        setIsLoginRegisterModalOpen(true);
        return;
    }

    const userMessage: Message = { role: 'user', text: inputValue };
    setIsLoading(true);
    setInputValue('');

    setSessions(prevSessions => {
        const activeSession = prevSessions.find(s => s.id === activeSessionId);
        if (!activeSession) return prevSessions;

        const isFirstUserMessage = activeSession.messages.filter(m => m.role === 'user').length === 0;
        const newTitle = isFirstUserMessage ? inputValue.substring(0, 30) + (inputValue.length > 30 ? '...' : '') : activeSession.title;

        const updatedMessages = [...activeSession.messages, userMessage];
        const updatedSession = { ...activeSession, messages: updatedMessages, title: newTitle };

        return prevSessions.map(s => s.id === activeSessionId ? updatedSession : s);
    });

    try {
      const response = await chat.sendMessage({ message: inputValue });
      const modelMessage: Message = { role: 'model', text: response.text };
      
      setSessions(prevSessions => prevSessions.map(s => {
          if (s.id === activeSessionId) {
              return { ...s, messages: [...s.messages, modelMessage] };
          }
          return s;
      }));
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = { role: 'model', text: 'Oops! Something went wrong. Please try again.' };
      setSessions(prevSessions => prevSessions.map(s => {
          if (s.id === activeSessionId) {
              return { ...s, messages: [...s.messages, errorMessage] };
          }
          return s;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditClick = (session: StoredSession) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
    setContextMenu(null); // Close context menu
  };

  const handleTitleSave = () => {
    if (!editingSessionId) return;
    const finalTitle = editingTitle.trim() || 'Untitled Chat';
    setSessions(prevSessions =>
        prevSessions.map(s =>
            s.id === editingSessionId ? { ...s, title: finalTitle } : s
        )
    );
    setEditingSessionId(null);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
        handleTitleSave();
    } else if (e.key === 'Escape') {
        setEditingSessionId(null);
    }
  };

  const handleDeleteSession = (sessionId: string) => {
    if (window.confirm('Are you sure you want to delete this chat session? This action cannot be undone.')) {
        setSessions(prevSessions => {
            const updatedSessions = prevSessions.filter(s => s.id !== sessionId);
            if (activeSessionId === sessionId) {
                // If the deleted session was active, activate the first available session or create a new one
                if (updatedSessions.length > 0) {
                    setActiveSessionId(updatedSessions[0].id);
                } else {
                    handleNewChat(true); // Create a new chat if no sessions left
                }
            }
            return updatedSessions;
        });
    }
    setContextMenu(null);
  };

  const handleArchiveSession = (sessionId: string) => {
    setSessions(prevSessions =>
        prevSessions.map(s =>
            s.id === sessionId ? { ...s, isArchived: !s.isArchived } : s
        )
    );
    // If the active session is being archived and showArchivedSessions is off, switch to a non-archived session
    if (activeSessionId === sessionId && !showArchivedSessions) {
        const remainingSessions = sessions.filter(s => s.id !== sessionId && !s.isArchived);
        if (remainingSessions.length > 0) {
            setActiveSessionId(remainingSessions[0].id);
        } else {
            // If no non-archived sessions left, create a new one
            handleNewChat(true);
        }
    }
    setContextMenu(null);
  };

  const handleOpenContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation(); // Prevent session selection
    e.preventDefault(); // Prevent default right-click context menu
    setContextMenu({
      sessionId,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const filteredSessions = sessions.filter(s => showArchivedSessions ? true : !s.isArchived);
  // Always include the active session, even if archived and showArchivedSessions is false
  const displayedSessions = activeSession && activeSession.isArchived && !showArchivedSessions
    ? [...filteredSessions, activeSession].filter((s, i, a) => a.findIndex(item => item.id === s.id) === i) // Deduplicate
    : filteredSessions;

  const CodeViewModal = ({ onClose }: { onClose: () => void }) => {
    const [htmlContent, setHtmlContent] = useState('');
    const [tsxContent, setTsxContent] = useState('');
    const [metadataContent, setMetadataContent] = useState('');
    const [activeFile, setActiveFile] = useState('index.tsx');

    useEffect(() => {
        // In a real app, these would be fetched from server or bundled
        // For this demo, we'll use placeholder content
        fetch('index.html').then(res => res.text()).then(setHtmlContent);
        fetch('index.tsx').then(res => res.text()).then(setTsxContent);
        fetch('metadata.json').then(res => res.text()).then(setMetadataContent);
    }, []);

    if (!isCodeViewVisible) return null;

    let displayContent = '';
    switch (activeFile) {
        case 'index.html':
            displayContent = htmlContent;
            break;
        case 'index.tsx':
            displayContent = tsxContent;
            break;
        case 'metadata.json':
            displayContent = metadataContent;
            break;
        default:
            displayContent = 'Select a file to view its content.';
    }

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="code-view-title">
            <div className="modal-content code-view-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 id="code-view-title">Application Code</h2>
                    <button className="close-button" onClick={onClose} aria-label="Close code view">&times;</button>
                </div>
                <div className="file-tabs" role="tablist">
                    <button role="tab" aria-selected={activeFile === 'index.tsx'} className={activeFile === 'index.tsx' ? 'active' : ''} onClick={() => setActiveFile('index.tsx')}>index.tsx</button>
                    <button role="tab" aria-selected={activeFile === 'index.html'} className={activeFile === 'index.html' ? 'active' : ''} onClick={() => setActiveFile('index.html')}>index.html</button>
                    <button role="tab" aria-selected={activeFile === 'metadata.json'} className={activeFile === 'metadata.json' ? 'active' : ''} onClick={() => setActiveFile('metadata.json')}>metadata.json</button>
                </div>
                <pre className="code-display" tabIndex={0}><code>{displayContent}</code></pre>
            </div>
        </div>
    );
  };
  
  const SettingsModal = () => {
    const [currentSettings, setCurrentSettings] = useState<AISettings>(aiSettings);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value, type, checked } = e.target as HTMLInputElement;
        setCurrentSettings(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : (type === 'number' ? parseFloat(value) : value),
        }));
    };

    const handleSave = () => {
        setAiSettings(currentSettings);
        setIsSettingsOpen(false);
    };

    if (!isSettingsOpen) return null;

    return (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)} role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2 id="settings-title">AI Settings</h2>
                <div className="setting-item">
                    <label htmlFor="model-select">Model</label>
                    <select id="model-select" name="model" value={currentSettings.model} onChange={handleChange} aria-label="Select AI model">
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    </select>
                </div>
                <div className="setting-item">
                    <label htmlFor="system-instruction-input">System Instruction</label>
                    <textarea
                        id="system-instruction-input"
                        name="systemInstruction"
                        value={currentSettings.systemInstruction}
                        onChange={handleChange}
                        placeholder="e.g., You are a friendly and helpful assistant."
                        rows={3}
                        aria-describedby="system-instruction-desc"
                    />
                     <p id="system-instruction-desc" className="setting-description">Define the AI's persona or specific instructions. This will be combined with the intelligent mode instruction.</p>
                </div>

                <div className="setting-item">
                    <label htmlFor="intelligent-mode-select">Intelligent Mode</label>
                    <select id="intelligent-mode-select" name="intelligentMode" value={currentSettings.intelligentMode} onChange={handleChange} aria-label="Select intelligent mode">
                        <option value="ahm ai 2.5">ahm ai 2.5</option>
                        <option value="ahm ai 5">ahm ai 5</option>
                    </select>
                     <p className="setting-description">Select the AI's core intelligence persona.</p>
                </div>

                <div className="setting-item-toggle">
                    <label htmlFor="code-is-nonbro-toggle">Code is nonbro</label>
                    <label className="switch">
                        <input
                            type="checkbox"
                            id="code-is-nonbro-toggle"
                            name="codeIsNonbro"
                            checked={!!currentSettings.codeIsNonbro}
                            onChange={handleChange}
                            aria-label="Toggle code is nonbro mode"
                        />
                        <span className="slider round"></span>
                    </label>
                    <p className="setting-description">Ensure code output is clean, well-documented, and professional.</p>
                </div>

                <div className="setting-item">
                    <label htmlFor="temperature-slider">
                        Temperature: {currentSettings.temperature?.toFixed(2)}
                    </label>
                    <input
                        id="temperature-slider"
                        type="range"
                        name="temperature"
                        min="0"
                        max="2"
                        step="0.01"
                        value={currentSettings.temperature}
                        onChange={handleChange}
                        aria-label="Adjust temperature"
                        aria-valuenow={currentSettings.temperature}
                        aria-valuemin={0}
                        aria-valuemax={2}
                    />
                    <p className="setting-description">Controls the randomness of the output. Lower values produce more deterministic responses.</p>
                </div>

                <div className="setting-item">
                    <label htmlFor="topP-slider">
                        Top P: {currentSettings.topP?.toFixed(2)}
                    </label>
                    <input
                        id="topP-slider"
                        type="range"
                        name="topP"
                        min="0"
                        max="1"
                        step="0.01"
                        value={currentSettings.topP}
                        onChange={handleChange}
                        aria-label="Adjust Top P"
                        aria-valuenow={currentSettings.topP}
                        aria-valuemin={0}
                        aria-valuemax={1}
                    />
                    <p className="setting-description">Filters tokens by probability mass. Lower values mean less diverse responses.</p>
                </div>

                <div className="setting-item">
                    <label htmlFor="topK-slider">
                        Top K: {currentSettings.topK}
                    </label>
                    <input
                        id="topK-slider"
                        type="range"
                        name="topK"
                        min="1"
                        max="40"
                        step="1"
                        value={currentSettings.topK}
                        onChange={handleChange}
                        aria-label="Adjust Top K"
                        aria-valuenow={currentSettings.topK}
                        aria-valuemin={1}
                        aria-valuemax={40}
                    />
                    <p className="setting-description">Filters tokens by top-k highest probabilities. Lower values reduce the range of possible words.</p>
                </div>

                <div className="modal-actions">
                    <button onClick={() => setIsSettingsOpen(false)}>Cancel</button>
                    <button onClick={handleSave}>Save</button>
                </div>
            </div>
        </div>
    );
  };

  const ShareModal = () => {
    const [shareLink, setShareLink] = useState('');
    const [copyButtonText, setCopyButtonText] = useState('Copy');

    useEffect(() => {
        if (activeSession) {
            const dataToShare = {
                title: activeSession.title,
                messages: activeSession.messages,
            };
            try {
                const encodedData = btoa(JSON.stringify(dataToShare));
                const url = `${window.location.origin}${window.location.pathname}?view=${encodedData}`;
                setShareLink(url);
            } catch (e) {
                // This can happen if the JSON string is too large or contains characters btoa doesn't like
                setShareLink('Error: Conversation is too long to share.');
            }
        }
    }, [activeSession]);

    const handleCopy = () => {
        if (shareLink && !shareLink.startsWith('Error')) {
            navigator.clipboard.writeText(shareLink).then(() => {
                setCopyButtonText('Copied!');
                setTimeout(() => setCopyButtonText('Copy'), 2000);
            }, () => {
                setCopyButtonText('Failed to copy');
            });
        }
    };

    const handleTogglePublic = () => {
        if(activeSessionId) {
            setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, isPublic: !s.isPublic } : s));
        }
    };

    if (!isShareModalOpen) return null;

    return (
        <div className="modal-overlay" onClick={() => setIsShareModalOpen(false)} role="dialog" aria-modal="true" aria-labelledby="share-chat-title">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2 id="share-chat-title">Share Chat</h2>
                <p className="setting-description">Anyone with this link will be able to view a read-only version of this conversation. The chat data is encoded in the link itself.</p>
                <div className="share-link-wrapper">
                    <input type="text" readOnly value={shareLink} aria-label="Shareable chat link" />
                    <button onClick={handleCopy}>{copyButtonText}</button>
                </div>
                <div className="setting-item-toggle">
                    <label htmlFor="is-public-toggle">Mark as Public</label>
                    <label className="switch">
                        <input
                            type="checkbox"
                            id="is-public-toggle"
                            checked={!!activeSession?.isPublic}
                            onChange={handleTogglePublic}
                            aria-label="Toggle public visibility for this chat"
                        />
                        <span className="slider round"></span>
                    </label>
                </div>
                 <div className="modal-actions">
                    <button onClick={() => setIsShareModalOpen(false)}>Done</button>
                </div>
            </div>
        </div>
    );
  };
  
  const LoginRegisterModal = ({ onClose }: { onClose: () => void }) => {
    const { currentUser, registeredUsers, loginUser, updateUserProfile } = useUser();
    const [tempUsername, setTempUsername] = useState('');
    const [tempIsVerified, setTempIsVerified] = useState(false); // Default to false for new registrations
    const [error, setError] = useState('');
    const [statusMessage, setStatusMessage] = useState(''); // New state for status message

    useEffect(() => {
        // Clear username if it's the default guest name when opening
        if (currentUser.id === DEFAULT_GUEST_USER_PROFILE.id) {
            setTempUsername('');
            setTempIsVerified(false); // Default for new registration
        } else {
            // If already logged in, pre-fill and don't change verified status
            setTempUsername(currentUser.username);
            setTempIsVerified(currentUser.isVerified);
        }
        setError('');
        setStatusMessage(''); // Reset status message
    }, [currentUser, isLoginRegisterModalOpen]); // Re-initialize when modal opens or current user changes

    // Effect to update status message based on username input
    useEffect(() => {
        const trimmedUsername = tempUsername.trim();
        if (!trimmedUsername) {
            setStatusMessage('');
            return;
        }

        const existingUser = registeredUsers.find(
            user => user.username.toLowerCase() === trimmedUsername.toLowerCase()
        );

        if (existingUser) {
            setStatusMessage('This username exists. You will be logged in as this user.');
            setTempIsVerified(existingUser.isVerified); // Auto-fill verified status for existing user
        } else {
            setStatusMessage('This username is available. You will be registered as a new user.');
            // Do not reset tempIsVerified here, let the user choose for new registrations
        }
    }, [tempUsername, registeredUsers]);


    const handleLoginRegister = () => {
        const trimmedUsername = tempUsername.trim();
        if (!trimmedUsername) {
            setError('Username cannot be empty.');
            return;
        }

        const existingUser = registeredUsers.find(
            user => user.username.toLowerCase() === trimmedUsername.toLowerCase()
        );

        if (existingUser) {
            // Login existing user
            loginUser(existingUser);
            alert(`Logged in as ${existingUser.username}`);
        } else {
            // Register new user
            const newUserProfile: UserProfile = {
                id: crypto.randomUUID(), // Generate a unique ID for the new user
                username: trimmedUsername,
                isVerified: tempIsVerified, // Use the state from checkbox
                profilePicture: null,
            };
            updateUserProfile(newUserProfile); // Adds to registeredUsers
            loginUser(newUserProfile); // Logs in the new user
            alert(`Registered and logged in as ${newUserProfile.username}`);
        }
        onClose();
    };

    const isLoginMode = !!tempUsername.trim() && registeredUsers.some(user => user.username.toLowerCase() === tempUsername.trim().toLowerCase());

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="login-register-title">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2 id="login-register-title">Login / Register</h2>
                <div className="setting-item">
                    <label htmlFor="username-input">Username</label>
                    <input
                        id="username-input"
                        type="text"
                        value={tempUsername}
                        onChange={(e) => setTempUsername(e.target.value)}
                        placeholder="Enter your username"
                        aria-required="true"
                    />
                     {statusMessage && <p className={`status-message ${isLoginMode ? 'login-status' : 'register-status'}`}>{statusMessage}</p>} {/* Display status message */}
                </div>
                <div className="setting-item-toggle">
                    <label htmlFor="is-verified-toggle">Mark as Verified (Pro)</label>
                    <label className="switch">
                        <input
                            type="checkbox"
                            id="is-verified-toggle"
                            checked={tempIsVerified}
                            onChange={(e) => setTempIsVerified(e.target.checked)}
                            aria-label="Toggle verified status for new account"
                            disabled={isLoginMode} // Disable if existing user, status is read-only
                        />
                        <span className="slider round"></span>
                    </label>
                </div>
                {error && <p className="error-message" role="alert">{error}</p>}
                <p className="setting-description">
                    (Note: This is a client-side simulation. No actual registration or verification occurs.)
                </p>
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button onClick={handleLoginRegister}>Set User</button>
                </div>
            </div>
        </div>
    );
  };

  const ProfileModal = ({ onClose }: { onClose: () => void }) => {
    const { currentUser, logoutUser, updateUserProfile } = useUser();
    const [tempUsername, setTempUsername] = useState(currentUser.username);
    const [tempProfilePicture, setTempProfilePicture] = useState<string | null>(currentUser.profilePicture);

    useEffect(() => {
        // Ensure modal state syncs with current user if it changes externally
        setTempUsername(currentUser.username);
        setTempProfilePicture(currentUser.profilePicture);
    }, [currentUser]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setTempProfilePicture(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSaveProfile = () => {
        const updatedProfile: UserProfile = {
            ...currentUser, // Maintain current user ID
            username: tempUsername.trim() || 'User',
            profilePicture: tempProfilePicture,
        };
        updateUserProfile(updatedProfile);
        onClose();
    };

    const handleLogoutClick = () => {
        logoutUser();
        onClose();
    };

    const handleToggleVerified = () => {
        const updatedProfile: UserProfile = {
            ...currentUser,
            isVerified: !currentUser.isVerified,
        };
        updateUserProfile(updatedProfile); // This will also update currentUser context
    };

    if (!currentUser || currentUser.id === DEFAULT_GUEST_USER_PROFILE.id) return null; // Only show if logged in

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="my-profile-title">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2 id="my-profile-title">My Profile</h2>
                <div className="profile-avatar-upload">
                    <div className="profile-preview-avatar" style={{ backgroundImage: tempProfilePicture ? `url(${tempProfilePicture})` : 'none' }}>
                        {!tempProfilePicture && tempUsername.charAt(0).toUpperCase()}
                    </div>
                    {currentUser.isVerified && <span className="pro-badge profile-pro-badge">PRO</span>}
                    <input type="file" accept="image/*" onChange={handleImageUpload} aria-label="Upload new profile picture" />
                    <p className="setting-description">Click to upload new profile picture.</p>
                </div>
                <div className="setting-item">
                    <label htmlFor="profile-username-input">Username</label>
                    <input
                        id="profile-username-input"
                        type="text"
                        value={tempUsername}
                        onChange={(e) => setTempUsername(e.target.value)}
                        aria-label="Edit username"
                    />
                </div>
                <div className="setting-item-toggle">
                    <label htmlFor="profile-is-verified-toggle">Account Verified (Pro)</label>
                    <label className="switch">
                        <input
                            type="checkbox"
                            id="profile-is-verified-toggle"
                            checked={currentUser.isVerified}
                            onChange={handleToggleVerified}
                            aria-label="Toggle account verified status"
                        />
                        <span className="slider round"></span>
                    </label>
                </div>
                <div className="modal-actions">
                    <button className="logout-button" onClick={handleLogoutClick}>Logout</button>
                    <button onClick={onClose}>Cancel</button>
                    <button onClick={handleSaveProfile}>Save Profile</button>
                </div>
            </div>
        </div>
    );
  };

  const UserListModal = ({ onClose }: { onClose: () => void }) => {
    const { registeredUsers, loginUser, currentUser } = useUser();

    const handleLoginAs = (userProfile: UserProfile) => {
        loginUser(userProfile);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="user-list-title">
            <div className="modal-content user-list-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 id="user-list-title">Registered Users</h2>
                    <button className="close-button" onClick={onClose} aria-label="Close user list">&times;</button>
                </div>
                <div className="users-container">
                    {registeredUsers.length === 0 ? (
                        <p>No users registered yet. Register via the bottom-left profile icon!</p>
                    ) : (
                        registeredUsers.map(userProfile => (
                            <div key={userProfile.id} className="user-list-item">
                                <div className="user-avatar" style={{ backgroundImage: userProfile.profilePicture ? `url(${userProfile.profilePicture})` : 'none' }}>
                                    {!userProfile.profilePicture && userProfile.username.charAt(0).toUpperCase()}
                                    {userProfile.isVerified && <span className="pro-badge">PRO</span>}
                                </div>
                                <span className="username-display">
                                    {userProfile.username} {userProfile.isVerified && <span className="verified-icon">&#10003;</span>}
                                </span>
                                {currentUser.id !== userProfile.id && (
                                    <button className="login-as-btn" onClick={() => handleLoginAs(userProfile)}>Login as</button>
                                )}
                                {currentUser.id === userProfile.id && (
                                    <span className="current-user-tag">Current</span>
                                )}
                            </div>
                        ))
                    )}
                </div>
                <div className="modal-actions">
                    <button onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
  };


  const PublicChatView = ({ sessionData }: { sessionData: NonNullable<typeof publicSessionData> }) => {
    return (
        <div className="public-view-container">
            <header className="chat-header">
                <span className="chat-header-title">{sessionData.title}</span>
            </header>
            <div className="messages-list">
                {sessionData.messages.map((msg, index) => (
                    <div key={index} className={`message ${msg.role}`} role="log">
                        {msg.text}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
        </div>
    );
  };

  const styles = `
    /* Reset and base styles */
    body {
        margin: 0;
        font-family: 'Roboto', sans-serif;
        color: #333;
        background-color: #f0f2f5;
        overflow: hidden;
    }

    #root {
        height: 100vh;
        width: 100vw;
    }

    /* App layout */
    .app-container {
      display: flex;
      height: 100vh;
      width: 100vw;
      background-color: #f0f2f5;
    }
    .sidebar {
      width: 260px;
      background-color: #202123;
      color: white;
      display: flex;
      flex-direction: column;
      padding: 1rem;
      border-right: 1px solid #333;
      flex-shrink: 0;
    }
    .sidebar-header {
      font-size: 1.25rem;
      font-weight: bold;
      padding: 0.75rem;
      margin: -1rem -1rem 1rem -1rem;
      background-color: #343541;
      text-align: center;
      cursor: pointer;
    }
    .new-chat-btn {
      padding: 0.75rem;
      border: 1px solid #555;
      background-color: transparent;
      color: white;
      border-radius: 8px;
      text-align: left;
      cursor: pointer;
      font-size: 1rem;
      transition: background-color 0.2s;
      margin-bottom: 1rem;
    }
    .new-chat-btn:hover {
      background-color: #343541;
    }
    .sessions-list {
      flex-grow: 1;
      overflow-y: auto;
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .session-item {
      padding: 0.75rem;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      position: relative; /* For context menu positioning */
    }
    .session-title-wrapper {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-grow: 1;
        overflow: hidden;
    }
    .public-icon {
        font-size: 0.8rem;
        opacity: 0.7;
    }
    .archived-icon {
        font-size: 0.8rem;
        opacity: 0.7;
        color: #f4b400; /* Yellowish for archive */
    }
    .session-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-item:hover {
      background-color: #343541;
    }
    .session-item.active {
      background-color: #4A90E2;
    }
    .session-edit-input {
      width: 100%;
      background-color: #343541;
      border: 1px solid #555;
      color: white;
      border-radius: 4px;
      padding: 0.5rem;
      font-size: 0.9rem;
      outline: none;
    }
    .sidebar-footer {
      border-top: 1px solid #333;
      padding-top: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .settings-btn {
        width: 100%;
        padding: 0.75rem;
        background: none;
        border: none;
        color: #ccc;
        cursor: pointer;
        text-align: left;
        font-size: 1rem;
        border-radius: 8px;
        transition: background-color 0.2s, color 0.2s;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .settings-btn:hover {
        background-color: #343541;
        color: white;
    }
    .user-info-section {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        transition: background-color 0.2s;
        background-color: #343541;
    }
    .user-info-section:hover {
        background-color: #444;
    }
    .user-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
        background-color: #555; /* Fallback for default avatar */
        border: 1px solid #777;
        position: relative;
        flex-shrink: 0;
        display: flex; /* For centering initial */
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 1.2rem;
        color: white;
    }
    .user-details {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .username-display {
        font-size: 1rem;
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }
    .status-text {
        font-size: 0.8rem;
        color: #aaa;
    }
    .verified-icon {
        color: #66bb6a; /* Green checkmark */
        font-size: 0.9em;
    }
    .pro-badge {
        position: absolute;
        bottom: -2px;
        right: -2px;
        background-color: gold;
        color: #333;
        font-size: 0.6em;
        font-weight: bold;
        padding: 2px 4px;
        border-radius: 4px;
        z-index: 10;
        line-height: 1;
    }
    
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      flex-grow: 1;
      background-color: #fff;
    }
    .public-view-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        background-color: #fff;
    }
    .chat-header {
      background-color: #4A90E2;
      color: white;
      padding: 1rem;
      font-size: 1.25rem;
      font-weight: bold;
      border-bottom: 1px solid #ddd;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .chat-header-actions {
        display: flex;
        gap: 0.5rem;
    }
    .header-btn {
        background-color: transparent;
        border: 1px solid white;
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.9rem;
        cursor: pointer;
        transition: background-color 0.2s;
    }
    .header-btn:hover {
        background-color: rgba(255, 255, 255, 0.2);
    }
    .messages-list {
      flex-grow: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .message {
      padding: 0.75rem 1rem;
      border-radius: 18px;
      max-width: 80%;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .message.user {
      background-color: #4A90E2;
      color: white;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .message.model {
      background-color: #f0f2f5;
      color: #333;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .loading-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      align-self: flex-start;
      padding: 0.75rem 1rem;
    }
    .loading-indicator span {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #ccc;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .loading-indicator span:nth-of-type(1) { animation-delay: -0.32s; }
    .loading-indicator span:nth-of-type(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1.0); }
    }
    .input-form-wrapper {
        padding: 1rem;
        border-top: 1px solid #ddd;
        background-color: #fff;
    }
    .input-form {
      display: flex;
      max-width: 800px;
      margin: 0 auto;
      gap: 0.5rem;
    }
    .input-form input {
      flex-grow: 1;
      padding: 0.75rem;
      border: 1px solid #ccc;
      border-radius: 20px;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .input-form input:focus {
      border-color: #4A90E2;
    }
    .input-form button {
      padding: 0.75rem 1.5rem;
      border: none;
      background-color: #4A90E2;
      color: white;
      border-radius: 20px;
      font-size: 1rem;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .input-form button:hover {
      background-color: #357ABD;
    }
    .input-form button:disabled {
      background-color: #a0c3e8;
    }
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }
    .modal-content {
        background-color: white;
        padding: 2rem;
        border-radius: 8px;
        width: 90%;
        max-width: 600px;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-height: 90vh;
        overflow-y: auto;
    }
    .modal-content.code-view-modal {
        max-width: 800px;
        width: 95%;
        gap: 1rem;
    }
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid #eee;
    }
    .modal-header h2 {
        margin: 0;
        font-size: 1.5rem;
    }
    .close-button {
        background: none;
        border: none;
        font-size: 1.8rem;
        cursor: pointer;
        color: #888;
    }
    .close-button:hover {
        color: #333;
    }
    .file-tabs {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
        border-bottom: 1px solid #eee;
        padding-bottom: 0.5rem;
        justify-content: center;
    }
    .file-tabs button {
        background-color: #f0f0f0;
        border: 1px solid #ccc;
        padding: 0.5rem 1rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
    }
    .file-tabs button.active {
        background-color: #4A90E2;
        color: white;
        border-color: #4A90E2;
    }
    .code-display {
        background-color: #f8f8f8;
        border: 1px solid #e0e0e0;
        padding: 1rem;
        border-radius: 4px;
        white-space: pre-wrap;
        word-break: break-all;
        overflow-x: auto;
        font-size: 0.85rem;
        line-height: 1.4;
        flex-grow: 1;
        margin: 0;
    }


    .modal-content h2 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
    }
    .setting-item, .setting-item-toggle {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .setting-item-toggle {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      margin-top: 1rem;
    }
    .setting-item label, .setting-item-toggle > label {
        font-weight: bold;
        display: flex;
        justify-content: space-between;
    }
    .setting-description {
        font-size: 0.85rem;
        color: #666;
        margin: -0.25rem 0 0.25rem 0;
    }
    .status-message {
        font-size: 0.85rem;
        margin: -0.25rem 0 0.25rem 0;
        padding-left: 0.25rem;
        border-radius: 4px;
    }
    .status-message.login-status {
        color: #3f51b5; /* Blue for login */
    }
    .status-message.register-status {
        color: #4CAF50; /* Green for register */
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 50px;
      height: 28px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: .4s;
    }
    input:checked + .slider {
      background-color: #4A90E2;
    }
    input:checked + .slider:before {
      transform: translateX(22px);
    }
    .slider.round {
      border-radius: 28px;
    }
    .slider.round:before {
      border-radius: 50%;
    }
    input:disabled + .slider {
      background-color: #b0b0b0; /* Dim background for disabled */
      cursor: not-allowed;
    }
    input:disabled + .slider:before {
        background-color: #e0e0e0;
    }
    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 1rem;
    }
    .modal-actions button {
        padding: 0.5rem 1rem;
        border-radius: 4px;
        border: 1px solid #ccc;
        cursor: pointer;
        font-size: 1rem;
    }
    .modal-actions button:last-child {
        background-color: #4A90E2;
        color: white;
        border-color: #4A90E2;
    }
    .share-link-wrapper {
        display: flex;
        gap: 0.5rem;
    }
    .share-link-wrapper input {
        flex-grow: 1;
        padding: 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 0.9rem;
        background-color: #f0f2f5;
    }
    .share-link-wrapper button {
        padding: 0.5rem 1rem;
        border: 1px solid #4A90E2;
        background-color: #4A90E2;
        color: white;
        border-radius: 4px;
        cursor: pointer;
    }

    /* Profile specific styles */
    .profile-avatar-upload {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        position: relative;
        cursor: pointer;
    }
    .profile-preview-avatar {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid #ddd;
        background-color: #f0f2f5; /* Fallback for no image */
        display: flex; /* For centering initial */
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 3rem;
        color: #777;
        background-size: cover; /* Ensure background image covers */
        background-position: center;
    }
    .profile-avatar-upload input[type="file"] {
        position: absolute;
        width: 100px;
        height: 100px;
        border-radius: 50%;
        opacity: 0;
        cursor: pointer;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
    }
    .profile-pro-badge {
        position: absolute;
        top: 75px; /* Adjust based on avatar size */
        left: 50%;
        transform: translateX(15px); /* Adjust to position correctly */
    }
    .logout-button {
        background-color: #d93025 !important;
        color: white !important;
        border-color: #d93025 !important;
    }

    /* User List Modal Specific Styles */
    .user-list-modal {
        max-width: 500px;
    }
    .users-container {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .user-list-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border: 1px solid #eee;
        border-radius: 8px;
        background-color: #f9f9f9;
    }
    .user-list-item .user-avatar {
        width: 40px;
        height: 40px;
        font-size: 1.5rem;
    }
    .user-list-item .username-display {
        flex-grow: 1;
    }
    .login-as-btn {
        padding: 0.4rem 0.8rem;
        border: 1px solid #4A90E2;
        background-color: #4A90E2;
        color: white;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
        font-size: 0.9rem;
    }
    .login-as-btn:hover {
        background-color: #357ABD;
    }
    .current-user-tag {
        background-color: #66bb6a;
        color: white;
        padding: 0.3em 0.6em;
        border-radius: 4px;
        font-size: 0.75em;
        font-weight: bold;
    }
    .error-message {
        color: #d93025;
        font-size: 0.9rem;
        text-align: center;
    }

    /* Kebab menu styles */
    .kebab-menu-button {
        background: none;
        border: none;
        color: #ccc;
        cursor: pointer;
        padding: 0 0.25rem;
        font-size: 1.2rem;
        line-height: 1;
        opacity: 0;
        transition: opacity 0.2s, background-color 0.2s;
        flex-shrink: 0;
    }
    .session-item:hover .kebab-menu-button,
    .session-item.active .kebab-menu-button {
        opacity: 1;
    }
    .kebab-menu-button:hover {
        color: white;
    }
    
    .context-menu {
        position: fixed;
        background-color: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1001;
        min-width: 150px;
        overflow: hidden;
    }
    .context-menu-item {
        padding: 0.75rem 1rem;
        cursor: pointer;
        font-size: 0.95rem;
        color: #333;
        transition: background-color 0.2s;
        display: block; /* Ensure full width clickable area */
        text-align: left;
        border: none;
        background: none;
        width: 100%;
    }
    .context-menu-item:hover {
        background-color: #f0f2f5;
    }
    .context-menu-item.delete {
        color: #d93025;
    }

    .archived-toggle-btn {
        width: 100%;
        padding: 0.75rem;
        background-color: #343541;
        border: none;
        color: white;
        cursor: pointer;
        text-align: center;
        font-size: 0.9rem;
        border-radius: 8px;
        transition: background-color 0.2s;
        margin-top: 0.5rem;
    }
    .archived-toggle-btn:hover {
        background-color: #444;
    }
    .archived-toggle-btn.active {
        background-color: #555;
        font-weight: bold;
    }
  `;

  if (publicSessionData) {
    return (
        <>
            <style>{styles}</style>
            <PublicChatView sessionData={publicSessionData} />
        </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <div className="app-container">
        <aside className="sidebar">
           <div className="sidebar-header" onClick={() => setIsCodeViewVisible(false)}>
            Normal AI
          </div>
          <button className="new-chat-btn" onClick={() => handleNewChat()}>
            + New Chat
          </button>
          <ul className="sessions-list">
            {displayedSessions.map(session => (
              <li 
                key={session.id} 
                className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => editingSessionId !== session.id && handleSelectSession(session.id)}
                onContextMenu={(e) => handleOpenContextMenu(e, session.id)} // Right-click to open menu
              >
                {editingSessionId === session.id ? (
                   <input
                        ref={editInputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={handleTitleSave}
                        onKeyDown={handleTitleKeyDown}
                        className="session-edit-input"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Edit session title for ${session.title}`}
                    />
                ) : (
                    <>
                        <div className="session-title-wrapper">
                            {session.isPublic && <span className="public-icon" title="Public">&#127760;</span>}
                            {session.isArchived && <span className="archived-icon" title="Archived">&#128450;&#xFE0F;</span>} {/* Archive icon */}
                            <span className="session-title" title={session.title}>
                               {session.title}
                            </span>
                        </div>
                        <button
                            className="kebab-menu-button"
                            onClick={(e) => handleOpenContextMenu(e, session.id)}
                            aria-label={`Actions for session ${session.title}`}
                        >
                            &#8942; {/* Vertical ellipsis (kebab) icon */}
                        </button>
                    </>
                )}
              </li>
            ))}
          </ul>
          {contextMenu && (
            <div
              ref={contextMenuRef}
              className="context-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              role="menu"
            >
              <button className="context-menu-item" onClick={() => handleEditClick(sessions.find(s => s.id === contextMenu.sessionId)!)} role="menuitem">Rename</button>
              <button className="context-menu-item delete" onClick={() => handleDeleteSession(contextMenu.sessionId)} role="menuitem">Delete</button>
              <button className="context-menu-item" onClick={() => handleArchiveSession(contextMenu.sessionId)} role="menuitem">
                {sessions.find(s => s.id === contextMenu.sessionId)?.isArchived ? 'Unarchive' : 'Archive'}
              </button>
            </div>
          )}
          <div className="sidebar-footer">
            <button 
                className={`archived-toggle-btn ${showArchivedSessions ? 'active' : ''}`} 
                onClick={() => setShowArchivedSessions(prev => !prev)}
                aria-pressed={showArchivedSessions}
            >
                {showArchivedSessions ? 'Hide Archived Chats' : 'Show Archived Chats'}
            </button>
            <button className="settings-btn" onClick={() => setIsSettingsOpen(true)} aria-label="Open AI settings">
                &#9881; Settings
            </button>
            <div 
                className="user-info-section" 
                onClick={() => currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id ? setIsProfileModalOpen(true) : setIsLoginRegisterModalOpen(true)}
                role="button"
                tabIndex={0}
                aria-label={currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id ? "Open profile settings" : "Login or Register"}
            >
                <div className="user-avatar" style={{ backgroundImage: currentUser.profilePicture ? `url(${currentUser.profilePicture})` : 'none' }}>
                    {!currentUser.profilePicture && currentUser.username.charAt(0).toUpperCase()}
                    {currentUser.isVerified && <span className="pro-badge">PRO</span>}
                </div>
                <div className="user-details">
                    <span className="username-display">
                        {currentUser.username} {currentUser.isVerified && <span className="verified-icon">&#10003;</span>}
                    </span>
                    <span className="status-text">{currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id ? 'Online' : 'Guest'}</span>
                </div>
            </div>
          </div>
        </aside>
        <main className="chat-container">
          <header className="chat-header">
            <span className="chat-header-title">{activeSession?.title || "AI Chat"}</span>
            <div className="chat-header-actions">
                <button className="header-btn" onClick={() => setIsShareModalOpen(true)} aria-label="Share current chat">
                    Share
                </button>
                <button className="header-btn" onClick={() => setIsCodeViewVisible(true)} aria-label="View application code">
                    Code
                </button>
                <button className="header-btn" onClick={() => setIsUserListModalOpen(true)} aria-label="View registered users">
                    &#128101; Users
                </button>
            </div>
          </header>
          <div className="messages-list">
            {activeSession?.messages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`} role="log">
                {msg.text}
              </div>
            ))}
            {isLoading && (
               <div className="loading-indicator" aria-live="polite" aria-label="AI is thinking">
                  <span></span>
                  <span></span>
                  <span></span>
               </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="input-form-wrapper">
            <form className="input-form" onSubmit={handleSendMessage}>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type your message..."
                aria-label="Chat input"
                disabled={isLoading}
              />
              <button type="submit" disabled={isLoading || !inputValue.trim()}>
                Send
              </button>
            </form>
          </div>
        </main>
        {isCodeViewVisible && <CodeViewModal onClose={() => setIsCodeViewVisible(false)} />}
        {isSettingsOpen && <SettingsModal />}
        {isShareModalOpen && <ShareModal />}
        {isLoginRegisterModalOpen && <LoginRegisterModal onClose={() => setIsLoginRegisterModalOpen(false)} />}
        {isProfileModalOpen && <ProfileModal onClose={() => setIsProfileModalOpen(false)} />}
        {isUserListModalOpen && <UserListModal onClose={() => setIsUserListModalOpen(false)} />}
      </div>
    </>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
    <UserProvider>
        <App />
    </UserProvider>
);Attr



