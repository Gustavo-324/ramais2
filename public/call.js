// call.js - Sistema completo de chamadas
class CallSystem {
    constructor(socket) {
        this.socket = socket;
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.isInCall = false;
        this.currentCall = null;
        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.init();
    }

    init() {
        this.setupSocketListeners();
        this.setupMediaHandlers();
    }

    setupSocketListeners() {
        // Receber oferta de chamada
        this.socket.on("webrtc-offer", async (data) => {
            if (this.isInCall) {
                this.socket.emit("webrtc-reject", { toSocketId: data.fromSocketId });
                return;
            }

            this.currentCall = {
                fromSocketId: data.fromSocketId,
                fromName: data.fromName,
                fromAvatar: data.fromAvatar,
                type: 'incoming'
            };

            await this.showIncomingCall(data.fromName, data.fromSocketId, data.fromAvatar);
        });

        // Receber resposta da chamada
        this.socket.on("webrtc-answer", async (data) => {
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(data.sdp);
            }
        });

        // Receber candidatos ICE
        this.socket.on("webrtc-icecandidate", (data) => {
            if (this.peerConnection) {
                this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });

        // Chamada rejeitada
        this.socket.on("webrtc-rejected", () => {
            this.hideCallInterface();
            this.showNotification('Chamada rejeitada');
        });

        // Chamada encerrada
        this.socket.on("webrtc-endcall", () => {
            this.endCall();
        });

        // Erro na chamada
        this.socket.on("call-error", (error) => {
            this.showNotification(error);
            this.hideCallInterface();
        });
    }

    async setupMediaHandlers() {
        try {
            // Testar permissões
            await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (error) {
            console.warn('Permissões de mídia não concedidas:', error);
        }
    }

    async showIncomingCall(callerName, callerSocketId, callerAvatar) {
        const overlay = document.createElement('div');
        overlay.className = 'call-overlay';
        overlay.id = 'incomingCallOverlay';
        
        let avatarContent = this.getInitials(callerName);
        if (callerAvatar) {
            avatarContent = `<img src="${callerAvatar}" alt="${callerName}">`;
        }
        
        overlay.innerHTML = `
            <div class="call-container">
                <div class="caller-info">
                    <div class="caller-avatar">${avatarContent}</div>
                    <div class="caller-name">${callerName}</div>
                    <div class="call-status">Chamada recebida</div>
                </div>
                <div class="call-buttons">
                    <button class="call-btn accept" onclick="callSystem.answerCall('${callerSocketId}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                    </button>
                    <button class="call-btn reject" onclick="callSystem.rejectCall('${callerSocketId}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        
        // Tocar tom de chamada
        this.playRingtone();
    }

    async makeCall(targetUser, isVideo = false) {
    if (this.isInCall) {
        this.showNotification('Você já está em uma chamada');
        return;
    }

    try {
        this.currentCall = {
            toSocketId: targetUser.socketId,
            toName: targetUser.name,
            type: 'outgoing',
            isVideo: isVideo
        };

        // Solicitar permissões de mídia
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: isVideo
        };

        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

        await this.createPeerConnection();
        this.showCallInterface(isVideo ? 'Videochamando...' : 'Chamando...');

        // Criar oferta
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        // Enviar oferta
        this.socket.emit("webrtc-offer", {
            toSocketId: targetUser.socketId,
            fromName: myName,
            sdp: offer,
            isVideo: isVideo
        });

    } catch (error) {
        console.error('Erro ao iniciar chamada:', error);
        this.showNotification('Erro ao iniciar chamada: ' + error.message);
        this.cleanup();
    }
}

    async answerCall(callerSocketId) {
        try {
            this.hideIncomingCall();
            this.stopRingtone();

            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            await this.createPeerConnection();
            this.showCallInterface('Em chamada');

            // Criar resposta
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            // Enviar resposta
            this.socket.emit("webrtc-answer", {
                toSocketId: callerSocketId,
                sdp: answer
            });

            this.isInCall = true;

        } catch (error) {
            console.error('Erro ao atender chamada:', error);
            this.showNotification('Erro ao atender chamada');
            this.cleanup();
        }
    }

    rejectCall(callerSocketId) {
        this.hideIncomingCall();
        this.stopRingtone();
        this.socket.emit("webrtc-reject", { toSocketId: callerSocketId });
    }

    async createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.config);

        // Adicionar stream local
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });

        // Receber stream remoto
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            this.setupRemoteAudio();
        };

        // Candidatos ICE
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit("webrtc-icecandidate", {
                    toSocketId: this.currentCall.type === 'outgoing' ? 
                        this.currentCall.toSocketId : this.currentCall.fromSocketId,
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Estado da conexão:', this.peerConnection.connectionState);
            
            if (this.peerConnection.connectionState === 'connected') {
                this.showNotification('Chamada conectada');
            } else if (this.peerConnection.connectionState === 'disconnected' ||
                      this.peerConnection.connectionState === 'failed') {
                this.endCall();
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('Estado ICE:', this.peerConnection.iceConnectionState);
        };
    }

    setupRemoteAudio() {
        const remoteAudio = document.getElementById('remoteAudio');
        if (!remoteAudio) {
            // Criar elemento de áudio se não existir
            const audio = document.createElement('audio');
            audio.id = 'remoteAudio';
            audio.autoplay = true;
            audio.style.display = 'none';
            document.body.appendChild(audio);
        }
        
        if (this.remoteStream) {
            document.getElementById('remoteAudio').srcObject = this.remoteStream;
        }
    }

    showCallInterface(status) {
        const controls = document.createElement('div');
        controls.className = 'call-controls';
        controls.id = 'callControls';
        
        controls.innerHTML = `
            <div class="call-status">${status}</div>
            <button class="control-btn end-call" onclick="callSystem.endCall()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        `;

        document.body.appendChild(controls);
        this.isInCall = true;
    }

    hideCallInterface() {
        const controls = document.getElementById('callControls');
        if (controls) {
            controls.remove();
        }
    }

    hideIncomingCall() {
        const overlay = document.getElementById('incomingCallOverlay');
        if (overlay) {
            overlay.remove();
        }
    }

    endCall() {
        if (this.currentCall) {
            this.socket.emit("webrtc-endcall", {
                toSocketId: this.currentCall.type === 'outgoing' ? 
                    this.currentCall.toSocketId : this.currentCall.fromSocketId
            });
        }
        
        this.cleanup();
        this.showNotification('Chamada encerrada');
    }

    cleanup() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        this.hideCallInterface();
        this.hideIncomingCall();
        this.stopRingtone();
        this.isInCall = false;
        this.currentCall = null;
    }

    playRingtone() {
        // Criar tom de chamada simples
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        
        oscillator.start();
        
        // Parar após 0.5 segundos e repetir
        setTimeout(() => {
            oscillator.stop();
            if (this.isInCall === false && this.currentCall) {
                this.ringtoneTimeout = setTimeout(() => this.playRingtone(), 1000);
            }
        }, 500);
    }

    stopRingtone() {
        if (this.ringtoneTimeout) {
            clearTimeout(this.ringtoneTimeout);
        }
    }

    showNotification(message) {
        // Usar a função existente do chat ou criar uma nova
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
            `;
            notification.textContent = message;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 3000);
        }
    }

    getInitials(name) {
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }
}

// Inicializar sistema de chamadas quando o socket estiver pronto
let callSystem;

function initCallSystem(socket) {
    callSystem = new CallSystem(socket);
}

// Funções globais para chamadas
function makeCallToUser(user) {
    if (callSystem) {
        callSystem.makeCall(user);
    }
}

function startVideoCallToUser(user) {
    showNotification('Videochamada em desenvolvimento');
}