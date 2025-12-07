
import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat, GenerateContentResponse } from '@google/genai';

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

interface StoredSession {
    id: string; // New: Unique ID for each chat session
    title: string;
    messages: Message[];
    settings: AISettings;
    isPublic: boolean;
    isArchived: boolean;
    ownerId: string; // New: To identify the owner
}
// New interface for centralizing all user sessions
interface AllUserSessions {
    [userId: string]: StoredSession[];
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

// The user context will now store the *currently active* user's profile
// and functions to manipulate the global list of registered users and all chat sessions.
interface UserContextType {
    currentUser: UserProfile;
    setCurrentUser: React.Dispatch<React.SetStateAction<UserProfile>>;
    registeredUsers: UserProfile[];
    setRegisteredUsers: React.Dispatch<React.SetStateAction<UserProfile[]>>;
    allUserSessions: AllUserSessions; // Centralized storage for all sessions
    setAllUserSessions: React.Dispatch<React.SetStateAction<AllUserSessions>>;

    loginUser: (profile: UserProfile) => void;
    logoutUser: () => void;
    updateUserProfile: (profile: UserProfile) => void;
    // Session management functions
    addSession: (session: StoredSession) => void;
    updateSession: (sessionId: string, userId: string, updates: Partial<StoredSession>) => void;
    deleteSession: (sessionId: string, userId: string) => void;
    archiveSession: (sessionId: string, userId: string) => void;
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
    const [allUserSessions, setAllUserSessions] = useState<AllUserSessions>({});

    // Load all registered users, all chat sessions, and the last active user on component mount
    useEffect(() => {
        try {
            const savedRegisteredUsers = localStorage.getItem('registeredUsers');
            if (savedRegisteredUsers) {
                const parsedRegisteredUsers: UserProfile[] = JSON.parse(savedRegisteredUsers);
                setRegisteredUsers(parsedRegisteredUsers);
            }

            const savedAllUserSessions = localStorage.getItem('allUserChatSessions');
            if (savedAllUserSessions) {
                const parsedAllUserSessions: AllUserSessions = JSON.parse(savedAllUserSessions);
                setAllUserSessions(parsedAllUserSessions);
            }

            const lastActiveUserId = localStorage.getItem('lastActiveUserId');
            if (lastActiveUserId) {
                // IMPORTANT: Use the *just loaded* registered users
                const usersToSearch = savedRegisteredUsers ? JSON.parse(savedRegisteredUsers) : [];
                const activeProfile = usersToSearch.find(p => p.id === lastActiveUserId);
                if (activeProfile) {
                    setCurrentUser(activeProfile);
                    return;
                }
            }
        } catch (error) {
            console.error("Failed to load user or session data from localStorage", error);
            localStorage.removeItem('registeredUsers');
            localStorage.removeItem('lastActiveUserId');
            localStorage.removeItem('allUserChatSessions');
        }
        setCurrentUser(DEFAULT_GUEST_USER_PROFILE);
    }, []);

    // Save registered users whenever the list changes
    useEffect(() => {
        try {
            localStorage.setItem('registeredUsers', JSON.stringify(registeredUsers));
        } catch (error) {
            console.error("Failed to save registered users to localStorage", error);
        }
    }, [registeredUsers]);

    // Save all user sessions whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('allUserChatSessions', JSON.stringify(allUserSessions));
        } catch (error) {
            console.error("Failed to save all user sessions to localStorage", error);
        }
    }, [allUserSessions]);

    // Save current user ID on change
    useEffect(() => {
        try {
            localStorage.setItem('lastActiveUserId', currentUser.id);
        } catch (error) {
            console.error("Failed to save last active user ID to localStorage", error);
        }
    }, [currentUser.id]);


    // User management functions
    const loginUser = useCallback((profile: UserProfile) => {
        setCurrentUser(profile);
        // Ensure the user is in registeredUsers if not already
        setRegisteredUsers(prevUsers => {
            if (!prevUsers.some(u => u.id === profile.id)) {
                return [...prevUsers, profile];
            }
            return prevUsers;
        });
    }, []);

    const logoutUser = useCallback(() => {
        setCurrentUser(DEFAULT_GUEST_USER_PROFILE);
    }, []);

    const updateUserProfile = useCallback((profile: UserProfile) => {
        setRegisteredUsers(prevUsers => {
            const index = prevUsers.findIndex(u => u.id === profile.id);
            if (index > -1) {
                const newUsers = [...prevUsers];
                newUsers[index] = profile;
                return newUsers;
            } else {
                // If it's a new user being registered for the first time
                return [...prevUsers, profile];
            }
        });
        // If the updated profile is the current user, update currentUser state
        if (currentUser.id === profile.id) {
            setCurrentUser(profile);
        }
    }, [currentUser]);

    // Session management functions
    const addSession = useCallback((session: StoredSession) => {
        setAllUserSessions(prevAllSessions => {
            const userSessions = prevAllSessions[session.ownerId] || [];
            return {
                ...prevAllSessions,
                [session.ownerId]: [...userSessions, session],
            };
        });
    }, []);

    const updateSession = useCallback((sessionId: string, userId: string, updates: Partial<StoredSession>) => {
        setAllUserSessions(prevAllSessions => {
            const userSessions = prevAllSessions[userId] || [];
            const updatedUserSessions = userSessions.map(s =>
                s.id === sessionId ? { ...s, ...updates } : s
            );
            return {
                ...prevAllSessions,
                [userId]: updatedUserSessions,
            };
        });
    }, []);

    const deleteSession = useCallback((sessionId: string, userId: string) => {
        setAllUserSessions(prevAllSessions => {
            const userSessions = prevAllSessions[userId] || [];
            const filteredUserSessions = userSessions.filter(s => s.id !== sessionId);
            return {
                ...prevAllSessions,
                [userId]: filteredUserSessions,
            };
        });
    }, []);

    const archiveSession = useCallback((sessionId: string, userId: string) => {
        updateSession(sessionId, userId, { isArchived: !allUserSessions[userId]?.find(s => s.id === sessionId)?.isArchived });
    }, [allUserSessions, updateSession]);

    const memoizedValue = React.useMemo(() => ({
        currentUser,
        setCurrentUser,
        registeredUsers,
        setRegisteredUsers,
        allUserSessions,
        setAllUserSessions,
        loginUser,
        logoutUser,
        updateUserProfile,
        addSession,
        updateSession,
        deleteSession,
        archiveSession,
    }), [
        currentUser,
        registeredUsers,
        allUserSessions,
        loginUser,
        logoutUser,
        updateUserProfile,
        addSession,
        updateSession,
        deleteSession,
        archiveSession,
        setCurrentUser, // Added for completeness, though not directly in dependency array elsewhere
        setRegisteredUsers, // Added for completeness
        setAllUserSessions, // Added for completeness
    ]);

    return (
        <UserContext.Provider value={memoizedValue}>
            {children}
        </UserContext.Provider>
    );
};

const App = () => {
  const {
    currentUser,
    loginUser,
    logoutUser,
    updateUserProfile,
    registeredUsers,
    allUserSessions,
    addSession,
    updateSession,
    deleteSession,
    archiveSession,
  } = useUser();

  // State declarations
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isApiKeyMissing, setIsApiKeyMissing] = useState<boolean>(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [showArchivedSessions, setShowArchivedSessions] = useState<boolean>(false);
  const [isCodePanelVisible, setIsCodePanelVisible] = useState<boolean>(false);
  const [isLoginRegisterModalOpen, setIsLoginRegisterModalOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isUserListModalOpen, setIsUserListModalOpen] = useState<boolean>(false);
  const [publicSessionData, setPublicSessionData] = useState<Omit<StoredSession, 'id' | 'settings' | 'isPublic' | 'isArchived' | 'ownerId'> | null>(null); // To view shared chats

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Derived state for sessions relevant to the current user
  const sessions = allUserSessions[currentUser.id] || [];
  const activeSession = sessions.find(s => s.id === activeSessionId);

  // --- Handlers & Callbacks ---
  const handleNewChat = useCallback((forceNew = false) => {
    if (!forceNew && currentUser.id === DEFAULT_GUEST_USER_PROFILE.id) {
        alert('Please log in or register to create new chat sessions.');
        setIsLoginRegisterModalOpen(true);
        return;
    }

    if (!forceNew && activeSessionId && sessions.find(s => s.id === activeSessionId && s.messages.length === 0)) {
        // If the current active session is empty, don't create a new one unless forced.
        return;
    }

    const newSession: StoredSession = {
        id: crypto.randomUUID(),
        title: 'New Chat',
        messages: [],
        settings: aiSettings, // Initialize with current global settings
        isPublic: false,
        isArchived: false,
        ownerId: currentUser.id,
    };
    addSession(newSession); // Add via context function
    setActiveSessionId(newSession.id);
    setInputValue('');
  }, [currentUser.id, activeSessionId, sessions, aiSettings, addSession]);


  // Handle clicks outside the context menu
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
      setContextMenu(null);
    }
  }, []);

  const handleSelectSession = (id: string) => {
    if (id !== activeSessionId) {
        setActiveSessionId(id);
        setContextMenu(null);
        // Reset chat instance to reflect new session's settings
        setChat(null); // This will trigger the useEffect to re-initialize chat with new settings
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || !chat || !activeSessionId) return;

    if (currentUser.id === DEFAULT_GUEST_USER_PROFILE.id) {
        alert('Please log in or register to send messages.');
        setIsLoginRegisterModalOpen(true);
        return;
    }

    if (isApiKeyMissing) {
        alert('API Key is missing. Cannot send message.');
        return;
    }

    const userMessage: Message = { role: 'user', text: inputValue };
    setIsLoading(true);
    setInputValue('');

    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (!activeSession) {
        setIsLoading(false);
        return;
    }

    const isFirstUserMessage = activeSession.messages.filter(m => m.role === 'user').length === 0;
    const newTitle = isFirstUserMessage ? inputValue.substring(0, 30) + (inputValue.length > 30 ? '...' : '') : activeSession.title;

    // Optimistically update session with user message
    const messagesAfterUserMessage = [...activeSession.messages, userMessage];
    updateSession(activeSessionId, currentUser.id, {
        messages: messagesAfterUserMessage,
        title: newTitle,
    });

    try {
      // Add a comment here: The `GenerateContentResponse` object has a property called `text` that directly provides the string output.
      const response: GenerateContentResponse = await chat.sendMessage({ message: inputValue });
      const modelMessage: Message = { role: 'model', text: response.text || '' }; // Ensure text is defined

      // Update with model message
      updateSession(activeSessionId, currentUser.id, {
          messages: [...messagesAfterUserMessage, modelMessage]
      });
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = { role: 'model', text: 'Oops! Something went wrong. Please try again.' };
      updateSession(activeSessionId, currentUser.id, {
          messages: [...messagesAfterUserMessage, errorMessage]
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditClick = (session: StoredSession) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
    setContextMenu(null);
    // Focus the input field after it becomes visible
    setTimeout(() => {
        editInputRef.current?.focus();
    }, 0);
  };

  const handleTitleSave = () => {
    if (!editingSessionId) return;
    const finalTitle = editingTitle.trim() || 'Untitled Chat';
    updateSession(editingSessionId, currentUser.id, { title: finalTitle });
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
        deleteSession(sessionId, currentUser.id); // Use context function
        // If the deleted session was active, activate the first available session or create a new one
        const updatedSessions = sessions.filter(s => s.id !== sessionId);
        if (activeSessionId === sessionId) {
            if (updatedSessions.length > 0) {
                setActiveSessionId(updatedSessions[0].id);
            } else {
                handleNewChat(true); // Force a new chat if no other sessions are available
            }
        }
    }
    setContextMenu(null);
  };

  const handleArchiveSession = (sessionId: string) => {
    archiveSession(sessionId, currentUser.id); // Use context function
    // If the active session is being archived and showArchivedSessions is off, switch to a non-archived session
    if (activeSessionId === sessionId && !showArchivedSessions) {
        const remainingSessions = sessions.filter(s => s.id !== sessionId && !s.isArchived);
        if (remainingSessions.length > 0) {
            setActiveSessionId(remainingSessions[0].id);
        } else {
            // If no non-archived sessions left, create a new one
            handleNewChat(true); // Force a new chat if no other non-archived sessions are available
        }
    }
    setContextMenu(null);
  };

  const handleOpenContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setContextMenu({
      sessionId,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const filteredSessions = sessions.filter(s => showArchivedSessions ? true : !s.isArchived);
  const displayedSessions = activeSession && activeSession.isArchived && !showArchivedSessions
    ? [...filteredSessions, activeSession].filter((s, i, a) => a.findIndex(item => item.id === s.id) === i)
    : filteredSessions;

  // API Key Check and Chat Initialization
  useEffect(() => {
    // Check API Key
    if (!process.env.API_KEY || process.env.API_KEY === 'YOUR_API_KEY') {
        setIsApiKeyMissing(true);
        console.error('API Key is missing or invalid. Please set the API_KEY environment variable.');
    } else {
        setIsApiKeyMissing(false);
    }
  }, []);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);

  // Public Session Data from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam) {
        try {
            const decodedData = JSON.parse(atob(viewParam));
            setPublicSessionData(decodedData);
        } catch (e) {
            console.error('Failed to parse public session data from URL', e);
            setPublicSessionData(null);
        }
    }
  }, []);

  // Initialize/Update chat instance when settings or active session changes
  useEffect(() => {
    if (!isApiKeyMissing && activeSessionId) {
        const currentSession = sessions.find(s => s.id === activeSessionId);
        const effectiveSettings = currentSession?.settings || aiSettings;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! }); // Non-null assertion after check
            const newChat = ai.chats.create({
                model: effectiveSettings.model,
                config: {
                    systemInstruction: effectiveSettings.systemInstruction,
                    temperature: effectiveSettings.temperature,
                    topK: effectiveSettings.topK,
                    topP: effectiveSettings.topP,
                    // Note: intelligentMode and codeIsNonbro are custom UI settings, not directly Gemini API configs.
                    // They would need to be translated into systemInstruction or prompt modifications.
                },
            });
            setChat(newChat);
        } catch (error) {
            console.error("Failed to initialize Gemini chat:", error);
            // Treat initialization error as API key issue if it's not explicitly a network error
            // In a real app, you might want more granular error checks.
            setIsApiKeyMissing(true);
        }
    } else {
        setChat(null); // Clear chat if no active session or API key is missing
    }
  }, [isApiKeyMissing, activeSessionId, sessions, aiSettings]); // Depend on relevant states


  // Set initial active session or create a new one
  useEffect(() => {
    if (currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id && sessions.length > 0 && !activeSessionId) {
        setActiveSessionId(sessions[0].id);
    } else if (currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id && sessions.length === 0 && !activeSessionId) {
        // Only create a new chat if there are no existing sessions for the logged-in user
        handleNewChat(true); // true to force creation
    }
  }, [currentUser.id, sessions, activeSessionId, handleNewChat]); // Dependencies: currentUser.id, sessions, activeSessionId, handleNewChat

  // Handle clicks outside the context menu
  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleClickOutside]);

  // New CodePanel component
  const CodePanel = () => {
    const [htmlContent, setHtmlContent] = useState('');
    const [tsxContent, setTsxContent] = useState('');
    const [metadataContent, setMetadataContent] = useState('');
    const [activeFile, setActiveFile] = useState('index.tsx');

    useEffect(() => {
        fetch('index.html').then(res => res.text()).then(setHtmlContent);
        fetch('index.tsx').then(res => res.text()).then(setTsxContent);
        fetch('metadata.json').then(res => res.text()).then(setMetadataContent);
    }, []);

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
        <div className="code-panel" role="region" aria-label="Application Code Panel">
            <div className="code-panel-header">
                <h3>Application Code</h3>
            </div>
            <div className="file-tabs" role="tablist">
                <button role="tab" aria-selected={activeFile === 'index.tsx'} className={activeFile === 'index.tsx' ? 'active' : ''} onClick={() => setActiveFile('index.tsx')}>index.tsx</button>
                <button role="tab" aria-selected={activeFile === 'index.html'} className={activeFile === 'index.html' ? 'active' : ''} onClick={() => setActiveFile('index.html')}>index.html</button>
                <button role="tab" aria-selected={activeFile === 'metadata.json'} className={activeFile === 'metadata.json' ? 'active' : ''} onClick={() => setActiveFile('metadata.json')}>metadata.json</button>
            </div>
            <pre className="code-display" tabIndex={0}><code>{displayContent}</code></pre>
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
        // Also update the settings for the currently active session
        if (activeSessionId && currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id) {
            updateSession(activeSessionId, currentUser.id, { settings: currentSettings });
        }
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
        if(activeSessionId && currentUser.id !== DEFAULT_GUEST_USER_PROFILE.id) {
            updateSession(activeSessionId, currentUser.id, { isPublic: !activeSession?.isPublic });
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
                            disabled={currentUser.id === DEFAULT_GUEST_USER_PROFILE.id}
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
    const [tempIsVerified, setTempIsVerified] = useState(false);
    const [error, setError] = useState('');
    const [statusMessage, setStatusMessage] = useState('');

    useEffect(() => {
        if (currentUser.id === DEFAULT_GUEST_USER_PROFILE.id) {
            setTempUsername('');
            setTempIsVerified(false);
        } else {
            setTempUsername(currentUser.username);
            setTempIsVerified(currentUser.isVerified);
        }
        setError('');
        setStatusMessage('');
    }, [currentUser, isLoginRegisterModalOpen]);

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
            setTempIsVerified(existingUser.isVerified);
        } else {
            setStatusMessage('This username is available. You will be registered as a new user.');
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
            loginUser(existingUser);
            alert(`Logged in as ${existingUser.username}`);
        } else {
            const newUserProfile: UserProfile = {
                id: crypto.randomUUID(),
                username: trimmedUsername,
                isVerified: tempIsVerified,
                profilePicture: null,
            };
            updateUserProfile(newUserProfile);
            loginUser(newUserProfile);
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
                     {statusMessage && <p className={`status-message ${isLoginMode ? 'login-status' : 'register-status'}`}>{statusMessage}</p>}
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
                            disabled={isLoginMode}
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
            ...currentUser,
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
        updateUserProfile(updatedProfile);
    };

    if (!currentUser || currentUser.id === DEFAULT_GUEST_USER_PROFILE.id) return null;

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
    const { registeredUsers, loginUser, currentUser, allUserSessions } = useUser();
    const [showAllActiveChats, setShowAllActiveChats] = useState(false);

    const handleLoginAs = (userProfile: UserProfile) => {
        loginUser(userProfile);
        onClose();
    };

    const handleViewChat = (ownerProfile: UserProfile, sessionId: string) => {
        loginUser(ownerProfile); // Switch to the owner of the chat
        setActiveSessionId(sessionId); // Set the active session
        onClose();
    };

    const allActiveChats: { user: UserProfile, session: StoredSession }[] = Object.values(allUserSessions)
        .flat()
        .filter(session => !session.isArchived)
        .map(session => ({
            user: registeredUsers.find(user => user.id === session.ownerId) || DEFAULT_GUEST_USER_PROFILE,
            session: session,
        }))
        .filter(item => item.user.id !== DEFAULT_GUEST_USER_PROFILE.id); // Filter out sessions from guest users

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="user-list-title">
            <div className="modal-content user-list-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 id="user-list-title">{showAllActiveChats ? 'All Active Chats' : 'Registered Users'}</h2>
                    <button className="close-button" onClick={onClose} aria-label="Close user list">Close</button>
                </div>

                {currentUser.isVerified && (
                    <div className="user-list-toggle-section">
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={showAllActiveChats}
                                onChange={() => setShowAllActiveChats(prev => !prev)}
                                aria-label="Toggle between registered users and all active chats"
                            />
                            <span className="slider round"></span>
                        </label>
                        <span className="toggle-label">View All Active Chats</span>
                    </div>
                )}
                {!currentUser.isVerified && showAllActiveChats && (
                    <p className="error-message">This feature is available for PRO users only.</p>
                )}


                <div className="users-container">
                    {showAllActiveChats && currentUser.isVerified ? (
                        allActiveChats.length === 0 ? (
                            <p>No active chats found across all users.</p>
                        ) : (
                            allActiveChats.map(item => (
                                <div key={item.session.id} className="user-list-item active-chat-item">
                                    <div className="user-avatar" style={{ backgroundImage: item.user.profilePicture ? `url(${item.user.profilePicture})` : 'none' }}>
                                        {!item.user.profilePicture && item.user.username.charAt(0).toUpperCase()}
                                        {item.user.isVerified && <span className="pro-badge">PRO</span>}
                                    </div>
                                    <div className="chat-details">
                                        <span className="username-display">{item.user.username}</span>
                                        <span className="chat-title">{item.session.title}</span>
                                        <span className="last-message-snippet">
                                            {item.session.messages.length > 0
                                                ? item.session.messages[item.session.messages.length - 1].text.substring(0, 50) + '...'
                                                : 'No messages yet.'}
                                        </span>
                                    </div>
                                    <button
                                        className="login-as-btn"
                                        onClick={() => handleViewChat(item.user, item.session.id)}
                                    >
                                        View Chat
                                    </button>
                                </div>
                            ))
                        )
                    ) : (
                        registeredUsers.length === 0 ? (
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
                        )
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

  if (publicSessionData) {
    return (
        <>
            <PublicChatView sessionData={publicSessionData} />
        </>
    );
  }

  return (
    <>
      <div className="app-container">
        <aside className="sidebar">
           <div className="sidebar-header" onClick={() => setIsCodePanelVisible(false)}>
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
                onContextMenu={(e) => handleOpenContextMenu(e, session.id)}
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
                            {session.isArchived && <span className="archived-icon" title="Archived">&#128450;&#xFE0F;</span>}
                            <span className="session-title" title={session.title}>
                               {session.title}
                            </span>
                        </div>
                        <button
                            className="kebab-menu-button"
                            onClick={(e) => handleOpenContextMenu(e, session.id)}
                            aria-label={`Actions for session ${session.title}`}
                        >
                            &#8942;
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
                <button className="header-btn" onClick={() => setIsCodePanelVisible(prev => !prev)} aria-label="Toggle application code panel">
                    Code
                </button>
                <button className="header-btn" onClick={() => setIsUserListModalOpen(true)} aria-label="View registered users">
                    &#128101; Users
                </button>
            </div>
          </header>
          <div className="main-content-area"> {/* New container for chat view and code panel */}
            <div className="chat-view-area"> {/* Contains messages and input */}
                <div className="messages-list">
                    {isApiKeyMissing && (
                        <div className="message model api-key-error" role="alert" aria-live="assertive">
                            API Key is missing. Please ensure it's configured correctly in your environment.
                        </div>
                    )}
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
                        disabled={isLoading || isApiKeyMissing}
                    />
                    <button type="submit" disabled={isLoading || !inputValue.trim() || isApiKeyMissing}>
                        Send
                    </button>
                    </form>
                </div>
            </div>
            {isCodePanelVisible && <CodePanel />} {/* Render CodePanel conditionally */}
          </div>
        </main>
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
);
