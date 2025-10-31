// room.js - Sistema de salas de reunião

// room.js - Sistema completo de salas de reunião
class RoomSystem {
    constructor(socket) {
        this.socket = socket;
        this.currentRoom = null;
        this.pendingInvites = new Map();
        this.init();
    }

    init() {
        this.setupSocketListeners();
        this.createMeetingModal();
    }

    setupSocketListeners() {
        this.socket.on("room-created", (data) => {
            this.showRoomInterface(data.roomId, data.roomName);
            this.showNotification(`Sala "${data.roomName}" criada com sucesso!`);
        });

        this.socket.on("room-joined", (data) => {
            this.showRoomInterface(data.roomId, data.roomName);
            this.updateParticipants(data.participants);
            this.showNotification(`Você entrou na sala "${data.roomName}"`);
        });

        this.socket.on("user-joined", (data) => {
            this.showNotification(`${data.userName} entrou na sala`);
            this.loadParticipants();
        });

        this.socket.on("user-left", (data) => {
            this.showNotification(`${data.userName} saiu da sala`);
            this.loadParticipants();
        });

        this.socket.on("room-message", (data) => {
            this.displayRoomMessage(data);
        });

        this.socket.on("active-rooms", (data) => {
            this.displayActiveRooms(data);
        });

        this.socket.on("room-error", (error) => {
            this.showNotification(error);
        });

        this.socket.on("room-invite", (data) => {
            this.showInviteNotification(data);
        });
    }

    createMeetingModal() {
        if (document.getElementById('meetingModal')) return;
        
        const modal = document.createElement('div');
        modal.id = 'meetingModal';
        modal.className = 'meeting-modal';
        modal.style.display = 'none';
        
        modal.innerHTML = `
            <div class="meeting-modal-content">
                <div class="meeting-modal-header">
                    <h3>Salas de Reunião</h3>
                    <button class="close-btn" onclick="roomSystem.closeMeetingModal()">&times;</button>
                </div>
                
                <div class="meeting-tabs">
                    <button class="meeting-tab active" onclick="roomSystem.switchMeetingTab('create')">Criar Sala</button>
                    <button class="meeting-tab" onclick="roomSystem.switchMeetingTab('join')">Entrar</button>
                    <button class="meeting-tab" onclick="roomSystem.switchMeetingTab('invites')">Convites</button>
                </div>
                
                <div id="createMeetingTab" class="meeting-tab-content active">
                    <div class="meeting-form-group">
                        <label for="roomName">Nome da Sala</label>
                        <input type="text" id="roomName" class="meeting-form-input" placeholder="Digite o nome da sala">
                    </div>
                    <button class="meeting-btn primary" onclick="roomSystem.createRoom()">Criar Sala</button>
                    
                    <div class="invite-section" id="inviteSection" style="display: none;">
                        <h4>Convite para a Sala</h4>
                        <div class="invite-link">
                            <input type="text" id="inviteLink" readonly>
                            <button onclick="roomSystem.copyInviteLink()">Copiar</button>
                        </div>
                        <div class="invited-users" id="invitedUsers"></div>
                    </div>
                </div>
                
                <div id="joinMeetingTab" class="meeting-tab-content">
                    <div class="meeting-form-group">
                        <label for="roomCode">Código da Sala</label>
                        <input type="text" id="roomCode" class="meeting-form-input" placeholder="Digite o código da sala">
                    </div>
                    <button class="meeting-btn primary" onclick="roomSystem.joinRoom()">Entrar na Sala</button>
                </div>
                
                <div id="invitesMeetingTab" class="meeting-tab-content">
                    <div id="pendingInvitesList">
                        <p style="text-align: center; color: #6b7280; padding: 20px;">Nenhum convite pendente</p>
                    </div>
                </div>
                
                <div class="active-meetings">
                    <h4>Salas Ativas</h4>
                    <div id="activeRoomsList"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    createRoom() {
        const roomName = document.getElementById('roomName').value.trim();
        if (!roomName) {
            this.showNotification('Digite um nome para a sala');
            return;
        }

        this.socket.emit("create-room", { roomName: roomName });
    }

    joinRoom() {
        const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
        if (!roomCode) {
            this.showNotification('Digite o código da sala');
            return;
        }

        this.socket.emit("join-room", { roomId: roomCode });
        this.closeMeetingModal();
    }

    // Novo método para convidar usuários
    inviteToRoom(user) {
        if (!this.currentRoom) {
            this.showNotification('Crie ou entre em uma sala primeiro');
            return;
        }

        this.socket.emit("room-invite", {
            roomId: this.currentRoom.id,
            roomName: this.currentRoom.name,
            toUserId: user.socketId,
            toUserName: user.name
        });

        this.showNotification(`Convite enviado para ${user.name}`);
    }

    showInviteNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'invite-notification';
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: white;
            border: 2px solid #5DADE2;
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
            z-index: 10001;
            max-width: 300px;
        `;

        notification.innerHTML = `
            <h4 style="margin: 0 0 8px 0; color: #1f2937;">Convite para Sala</h4>
            <p style="margin: 0 0 12px 0; color: #6b7280; font-size: 14px;">
                ${data.inviterName} convidou você para a sala "${data.roomName}"
            </p>
            <div style="display: flex; gap: 8px;">
                <button onclick="roomSystem.acceptInvite('${data.roomId}')" style="flex:1; padding:8px; background:#10b981; color:white; border:none; border-radius:6px; cursor:pointer;">
                    Aceitar
                </button>
                <button onclick="this.parentElement.parentElement.remove()" style="flex:1; padding:8px; background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer;">
                    Recusar
                </button>
            </div>
        `;

        document.body.appendChild(notification);

        // Auto-remove após 30 segundos
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 30000);
    }

    acceptInvite(roomId) {
        this.socket.emit("join-room", { roomId: roomId });
        this.closeMeetingModal();
        
        // Remover todas as notificações de convite
        document.querySelectorAll('.invite-notification').forEach(notification => {
            notification.remove();
        });
    }

    // Resto do código permanece similar...
    copyInviteLink() {
        const inviteLink = document.getElementById('inviteLink');
        inviteLink.select();
        document.execCommand('copy');
        this.showNotification('Link copiado para a área de transferência!');
    }

    openMeetingModal() {
        document.getElementById('meetingModal').style.display = 'flex';
        this.loadActiveRooms();
    }

    closeMeetingModal() {
        document.getElementById('meetingModal').style.display = 'none';
    }

    switchMeetingTab(tab) {
        // Implementação similar à anterior...
        document.querySelectorAll('.meeting-tab').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.meeting-tab-content').forEach(content => content.classList.remove('active'));
        
        const tabElements = {
            'create': { tab: 0, content: 'createMeetingTab' },
            'join': { tab: 1, content: 'joinMeetingTab' },
            'invites': { tab: 2, content: 'invitesMeetingTab' }
        };
        
        const tabInfo = tabElements[tab];
        document.querySelectorAll('.meeting-tab')[tabInfo.tab].classList.add('active');
        document.getElementById(tabInfo.content).classList.add('active');
    }

    // ... resto das funções existentes
} 

class RoomSystem {
    constructor(socket) {
        this.socket = socket;
        this.currentRoom = null;
        this.init();
    }

    init() {
        this.setupSocketListeners();
        this.loadActiveRooms();
    }

    setupSocketListeners() {
        this.socket.on("room-created", (data) => {
            this.showRoomInterface(data.roomId, data.roomName);
            this.showNotification(`Sala "${data.roomName}" criada com sucesso!`);
        });

        this.socket.on("room-joined", (data) => {
            this.showRoomInterface(data.roomId, data.roomName);
            this.updateParticipants(data.participants);
            this.showNotification(`Você entrou na sala "${data.roomName}"`);
        });

        this.socket.on("user-joined", (data) => {
            this.showNotification(`${data.userName} entrou na sala`);
            this.loadParticipants();
        });

        this.socket.on("user-left", (data) => {
            this.showNotification(`${data.userName} saiu da sala`);
            this.loadParticipants();
        });

        this.socket.on("room-message", (data) => {
            this.displayRoomMessage(data);
        });

        this.socket.on("active-rooms", (data) => {
            this.displayActiveRooms(data);
        });

        this.socket.on("room-error", (error) => {
            this.showNotification(error);
        });
    }

    

    createRoom(roomName) {
        if (!roomName.trim()) {
            this.showNotification('Digite um nome para a sala');
            return;
        }

        this.socket.emit("create-room", { roomName: roomName.trim() });
    }

    joinRoom(roomCode) {
        if (!roomCode.trim()) {
            this.showNotification('Digite o código da sala');
            return;
        }

        this.socket.emit("join-room", { roomId: roomCode.trim().toUpperCase() });
    }

    leaveRoom() {
        if (this.currentRoom) {
            this.socket.emit("leave-room", { roomId: this.currentRoom.id });
            this.hideRoomInterface();
            this.showNotification('Você saiu da sala');
        }
    }

    sendRoomMessage(message) {
        if (!this.currentRoom || !message.trim()) return;

        this.socket.emit("room-message", {
            roomId: this.currentRoom.id,
            text: message.trim()
        });

        // Adicionar mensagem localmente
        this.displayRoomMessage({
            from: myName,
            text: message.trim(),
            timestamp: new Date().toISOString()
        });

        // Limpar input
        const messageInput = document.getElementById('roomMessageInput');
        if (messageInput) {
            messageInput.value = '';
        }
    }

    showRoomInterface(roomId, roomName) {
        this.currentRoom = { id: roomId, name: roomName };
        
        // Criar interface da sala se não existir
        if (!document.getElementById('roomInterface')) {
            this.createRoomInterface();
        }
        
        document.getElementById('roomInterface').style.display = 'flex';
        document.getElementById('roomTitle').textContent = roomName;
        this.closeRoomModal();
        
        // Limpar mensagens anteriores
        const messagesContainer = document.getElementById('roomMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
        
        // Carregar participantes
        this.loadParticipants();
    }

    createRoomInterface() {
        const roomInterface = document.createElement('div');
        roomInterface.id = 'roomInterface';
        roomInterface.className = 'room-interface';
        roomInterface.style.display = 'none';
        
        roomInterface.innerHTML = `
            <div class="room-header">
                <h3 id="roomTitle">Sala de Reunião</h3>
                <button onclick="roomSystem.leaveRoom()" class="btn secondary">Sair da Sala</button>
            </div>
            <div class="room-content">
                <div class="room-participants">
                    <h4>Participantes</h4>
                    <div id="participantsList"></div>
                </div>
                <div class="room-chat">
                    <div id="roomMessages" class="room-messages"></div>
                    <div class="message-input">
                        <input type="text" id="roomMessageInput" placeholder="Digite sua mensagem...">
                        <button onclick="roomSystem.sendRoomMessage()" class="btn primary">Enviar</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(roomInterface);
        
        // Configurar evento de tecla Enter
        const messageInput = document.getElementById('roomMessageInput');
        if (messageInput) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendRoomMessage();
                }
            });
        }
    }

    hideRoomInterface() {
        const roomInterface = document.getElementById('roomInterface');
        if (roomInterface) {
            roomInterface.style.display = 'none';
        }
        this.currentRoom = null;
    }

    loadParticipants() {
        if (!this.currentRoom) return;
        
        // Em uma implementação real, isso viria do servidor
        // Por enquanto, vamos simular
        setTimeout(() => {
            this.socket.emit("get-active-rooms");
        }, 1000);
    }

    updateParticipants(participants) {
        const list = document.getElementById('participantsList');
        if (!list) return;
        
        list.innerHTML = '';

        participants.forEach(participant => {
            if (!participant) return;
            
            const item = document.createElement('div');
            item.className = 'participant-item';
            
            let avatarContent = this.getInitials(participant.name);
            if (participant.avatar) {
                avatarContent = `<img src="${participant.avatar}" alt="${participant.name}">`;
            }
            
            item.innerHTML = `
                <div class="participant-avatar">${avatarContent}</div>
                <span class="participant-name">${participant.name}</span>
            `;
            list.appendChild(item);
        });
    }

    displayRoomMessage(data) {
        const messagesContainer = document.getElementById('roomMessages');
        if (!messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${data.from === myName ? 'own-message' : 'other-message'}`;
        
        const time = new Date(data.timestamp).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageDiv.innerHTML = `
            <div class="message-header">
                <strong>${data.from}</strong>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">${data.text}</div>
        `;

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    loadActiveRooms() {
        this.socket.emit("get-active-rooms");
    }

    displayActiveRooms(rooms) {
        const roomsList = document.getElementById('roomsList');
        if (!roomsList) return;
        
        roomsList.innerHTML = '';

        if (rooms.length === 0) {
            roomsList.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 20px;">Nenhuma sala ativa no momento</p>';
            return;
        }

        rooms.forEach(room => {
            const roomItem = document.createElement('div');
            roomItem.className = 'room-item';
            roomItem.innerHTML = `
                <div class="room-info">
                    <h5>${room.name}</h5>
                    <span>Criada por ${room.creator} • ${room.participants} participantes</span>
                </div>
                <button class="btn primary" onclick="roomSystem.joinRoom('${room.id}')">Entrar</button>
            `;
            roomsList.appendChild(roomItem);
        });
    }

    openRoomModal() {
        this.createRoomModal();
        document.getElementById('roomModal').style.display = 'flex';
        this.loadActiveRooms();
    }

    createRoomModal() {
        if (document.getElementById('roomModal')) return;
        
        const modal = document.createElement('div');
        modal.id = 'roomModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Salas de Reunião</h3>
                    <button class="close-btn" onclick="roomSystem.closeRoomModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="tab-buttons">
                        <button class="tab-btn active" onclick="roomSystem.switchRoomTab('create')">Criar Sala</button>
                        <button class="tab-btn" onclick="roomSystem.switchRoomTab('join')">Entrar em Sala</button>
                    </div>
                    
                    <div id="createRoomTab" class="tab-content active">
                        <input type="text" id="roomName" placeholder="Nome da sala" class="form-input">
                        <button onclick="roomSystem.createRoom(document.getElementById('roomName').value)" class="btn primary">Criar Sala</button>
                    </div>
                    
                    <div id="joinRoomTab" class="tab-content">
                        <input type="text" id="roomCode" placeholder="Código da sala" class="form-input">
                        <button onclick="roomSystem.joinRoom(document.getElementById('roomCode').value)" class="btn primary">Entrar na Sala</button>
                    </div>
                    
                    <div class="active-rooms">
                        <h4>Salas Ativas</h4>
                        <div id="roomsList"></div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    closeRoomModal() {
        const modal = document.getElementById('roomModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    switchRoomTab(tab) {
        // Atualizar botões
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        // Ativar aba selecionada
        const tabIndex = tab === 'create' ? 0 : 1;
        document.querySelectorAll('.tab-btn')[tabIndex].classList.add('active');
        document.getElementById(`${tab}RoomTab`).classList.add('active');
    }

    getInitials(name) {
        if (!name) return '??';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }

    showNotification(message) {
        if (typeof showNotification === 'function') {
            showNotification(message);
        } else {
            // Criar notificação simples
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 100px;
                right: 20px;
                background: #10b981;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                z-index: 10000;
                font-weight: 600;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            `;
            notification.textContent = message;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 3000);
        }
    }
}

// Inicializar sistema de salas
let roomSystem;

function initRoomSystem(socket) {
    roomSystem = new RoomSystem(socket);
}

// Funções globais para interface
function openRoomModal() {
    if (roomSystem) {
        roomSystem.openRoomModal();
    }
}

function closeRoomModal() {
    if (roomSystem) {
        roomSystem.closeRoomModal();
    }
}