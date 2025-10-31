const express = require("express");
const http = require("http");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: '50mb' }));

// Arquivo para persistência dos dados
const DATA_FILE = path.join(__dirname, "data.json");

// Carregar dados persistentes
function loadPersistentData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
  }
  return { 
    users: [], 
    calls: [], 
    chatRooms: [],
    messages: [],
    userStatus: {}
  };
}

// Salvar dados persistentes
function savePersistentData() {
  try {
    const data = {
      users: Array.from(users.entries()).map(([socketId, user]) => ({
        ...user,
        socketId
      })),
      calls: Array.from(activeCalls.entries()),
      chatRooms: Array.from(chatRooms.entries()),
      messages: Array.from(chatMessages.entries()),
      userStatus: Object.fromEntries(
        Array.from(users.entries()).map(([socketId, user]) => [
          user.name,
          { online: user.online, lastSeen: user.lastSeen }
        ])
      )
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Erro ao salvar dados:", error);
  }
}

// Carregar dados ao iniciar
const persistentData = loadPersistentData();

const users = new Map();
const activeCalls = new Map();
const chatMessages = new Map();
const unreadMessages = new Map();
const userAvatars = new Map();
const chatRooms = new Map();

// Inicializar com dados persistentes
persistentData.users.forEach(user => {
  users.set(user.socketId, { ...user, online: false });
});

persistentData.messages.forEach(([key, messages]) => {
  chatMessages.set(key, messages);
});

// Rota principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat.html"));
});

// Rota para dashboard
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard.html"));
});

// Rota para obter dados do dashboard
app.get("/api/dashboard-data", (req, res) => {
  const onlineUsers = Array.from(users.values()).filter(user => user.online);
  const today = new Date().toDateString();
  const callsToday = persistentData.calls.filter(call => 
    new Date(call.timestamp).toDateString() === today
  ).length;
  
  const missedCalls = persistentData.calls.filter(call => 
    !call.answered && new Date(call.timestamp).toDateString() === today
  ).length;

  res.json({
    onlineUsers: onlineUsers.length,
    totalUsers: users.size,
    callsToday: callsToday,
    missedCalls: missedCalls,
    activeRooms: chatRooms.size
  });
});

// Rota para obter histórico de chamadas
app.get("/api/call-history", (req, res) => {
  const recentCalls = persistentData.calls
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);
  
  res.json(recentCalls);
});

// Socket.io
io.on("connection", (socket) => {
  console.log("🟢 Novo usuário conectado:", socket.id);


  // No evento de connection, adicionar:
socket.on("room-invite", (data) => {
    const targetSocket = io.sockets.sockets.get(data.toUserId);
    if (targetSocket) {
        targetSocket.emit("room-invite", {
            roomId: data.roomId,
            roomName: data.roomName,
            inviterName: users.get(socket.id)?.name
        });
    }
});

  // Registro
  socket.on("register", (payload) => {
    const userData = {
      name: payload.name, 
      online: true, 
      socketId: socket.id,
      avatar: userAvatars.get(payload.name) || payload.avatar || null,
      lastSeen: new Date().toISOString()
    };
    
    users.set(socket.id, userData);
    unreadMessages.set(payload.name, new Map());
    
    // Salvar dados persistentemente
    savePersistentData();
    
    // Notificar todos sobre novo usuário
    broadcastUserList();
    console.log(`📝 Usuário registrado: ${payload.name}`);
  });

  // Atualizar avatar
  socket.on("update-avatar", (data) => {
    const user = users.get(socket.id);
    if (user) {
      user.avatar = data.avatar;
      userAvatars.set(user.name, data.avatar);
      
      // Broadcast para todos os usuários
      io.emit("user-avatar-updated", {
        userName: user.name,
        avatar: data.avatar
      });
      
      broadcastUserList();
      console.log(`🖼️ Avatar atualizado para: ${user.name}`);
    }
  });

  // Solicitar histórico do chat
  socket.on("request-chat-history", (data) => {
    const chatKey = [data.user1, data.user2].sort().join('_');
    const history = chatMessages.get(chatKey) || [];
    socket.emit("chat-history", { 
      withUser: data.withUser, 
      messages: history 
    });
    
    if (unreadMessages.has(data.user1)) {
      unreadMessages.get(data.user1).set(data.withUser, 0);
    }
  });

  // Mensagens
  socket.on("chatMessage", (data) => {
    const targetSocket = io.sockets.sockets.get(data.toSocketId);
    
    if (targetSocket) {
      const chatKey = [data.from, data.targetName].sort().join('_');
      if (!chatMessages.has(chatKey)) {
        chatMessages.set(chatKey, []);
      }
      
      const message = {
        from: data.from,
        text: data.text,
        timestamp: new Date().toISOString(),
        type: data.type || 'text',
        file: data.file || null
      };
      
      chatMessages.get(chatKey).push(message);
      
      // Incrementa contador de mensagens não lidas
      if (unreadMessages.has(data.targetName)) {
        const userUnread = unreadMessages.get(data.targetName);
        userUnread.set(data.from, (userUnread.get(data.from) || 0) + 1);
      }
      
      // Envia mensagem para o destinatário
      targetSocket.emit("chatMessage", message);
      
      // Envia notificação para o dashboard
      io.emit("dashboard-notification", {
        type: "new_message",
        from: data.from,
        to: data.targetName,
        message: data.text,
        timestamp: new Date().toISOString()
      });
      
      // Envia atualização de mensagens não lidas
      targetSocket.emit("unread-update", Array.from(unreadMessages.get(data.targetName) || []));
      socket.emit("unread-update", Array.from(unreadMessages.get(data.from) || []));
      
      // Salvar dados
      savePersistentData();
    }
  });

  // Solicitar mensagens não lidas
  socket.on("get-unread-messages", (userName) => {
    const userUnread = unreadMessages.get(userName);
    if (userUnread) {
      socket.emit("unread-update", Array.from(userUnread));
    }
  });

  // WebRTC - Sistema de Chamadas
  socket.on("webrtc-offer", async (data) => {
    const target = io.sockets.sockets.get(data.toSocketId);
    if (target) {
      // Registrar a chamada
      const callData = {
        from: data.fromName,
        to: users.get(data.toSocketId)?.name,
        timestamp: new Date().toISOString(),
        type: 'outgoing',
        answered: false
      };
      
      persistentData.calls.push(callData);
      savePersistentData();
      
      activeCalls.set(socket.id, data.toSocketId);
      activeCalls.set(data.toSocketId, socket.id);
      
      target.emit("webrtc-offer", { 
        fromSocketId: socket.id, 
        fromName: data.fromName,
        fromAvatar: userAvatars.get(data.fromName),
        sdp: data.sdp 
      });
      
      // Notificar dashboard sobre nova chamada
      io.emit("dashboard-notification", {
        type: "new_call",
        from: data.fromName,
        to: users.get(data.toSocketId)?.name,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📞 Chamada de ${data.fromName} para ${data.toSocketId}`);
    } else {
      socket.emit("call-error", "Usuário não está disponível");
    }
  });

  socket.on("webrtc-answer", (data) => {
    const target = io.sockets.sockets.get(data.toSocketId);
    if (target) {
      target.emit("webrtc-answer", data);
      
      // Atualizar chamada como atendida
      const callIndex = persistentData.calls.findIndex(call => 
        call.from === users.get(data.toSocketId)?.name && 
        call.to === users.get(socket.id)?.name &&
        !call.answered
      );
      
      if (callIndex !== -1) {
        persistentData.calls[callIndex].answered = true;
        persistentData.calls[callIndex].answeredAt = new Date().toISOString();
        savePersistentData();
      }
      
      console.log(`✅ Chamada atendida por ${data.toSocketId}`);
    }
  });

  socket.on("webrtc-icecandidate", (data) => {
    const target = io.sockets.sockets.get(data.toSocketId);
    if (target) target.emit("webrtc-icecandidate", data);
  });

  socket.on("webrtc-reject", (data) => {
    const target = io.sockets.sockets.get(data.toSocketId);
    if (target) {
      target.emit("webrtc-rejected");
      socket.emit("call-ended");
    }
    activeCalls.delete(socket.id);
    activeCalls.delete(data.toSocketId);
    
    // Registrar chamada rejeitada
    const callData = {
      from: users.get(data.toSocketId)?.name,
      to: users.get(socket.id)?.name,
      timestamp: new Date().toISOString(),
      type: 'incoming',
      answered: false,
      rejected: true
    };
    
    persistentData.calls.push(callData);
    savePersistentData();
    
    console.log(`❌ Chamada recusada para ${data.toSocketId}`);
  });

  socket.on("webrtc-endcall", (data) => {
    const target = io.sockets.sockets.get(data.toSocketId);
    if (target) {
      target.emit("webrtc-endcall");
      socket.emit("call-ended");
    }
    activeCalls.delete(socket.id);
    activeCalls.delete(data.toSocketId);
    
    // Calcular duração da chamada
    const callIndex = persistentData.calls.findIndex(call => 
      (call.from === users.get(socket.id)?.name && call.to === users.get(data.toSocketId)?.name) ||
      (call.from === users.get(data.toSocketId)?.name && call.to === users.get(socket.id)?.name)
    );
    
    if (callIndex !== -1 && persistentData.calls[callIndex].answered) {
      const startTime = new Date(persistentData.calls[callIndex].answeredAt);
      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000); // em segundos
      
      persistentData.calls[callIndex].duration = duration;
      savePersistentData();
    }
    
    console.log(`📞 Chamada encerrada entre ${socket.id} e ${data.toSocketId}`);
  });

  // Sistema de Salas de Reunião
  socket.on("create-room", (data) => {
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      name: data.roomName,
      creator: socket.id,
      creatorName: users.get(socket.id)?.name,
      participants: new Set([socket.id]),
      createdAt: new Date().toISOString()
    };
    
    chatRooms.set(roomId, room);
    socket.join(roomId);
    
    socket.emit("room-created", { roomId, roomName: data.roomName });
    
    // Notificar dashboard
    io.emit("dashboard-notification", {
      type: "room_created",
      roomName: data.roomName,
      creator: users.get(socket.id)?.name,
      timestamp: new Date().toISOString()
    });
    
    console.log(`🎪 Sala criada: ${data.roomName} (${roomId})`);
  });

  socket.on("join-room", (data) => {
    const room = chatRooms.get(data.roomId);
    if (room) {
      room.participants.add(socket.id);
      socket.join(data.roomId);
      
      // Notificar outros participantes
      socket.to(data.roomId).emit("user-joined", {
        userName: users.get(socket.id)?.name,
        userAvatar: users.get(socket.id)?.avatar,
        roomId: data.roomId
      });
      
      socket.emit("room-joined", {
        roomId: data.roomId,
        roomName: room.name,
        participants: Array.from(room.participants).map(id => users.get(id))
      });
      
      console.log(`👥 ${users.get(socket.id)?.name} entrou na sala ${room.name}`);
    } else {
      socket.emit("room-error", "Sala não encontrada");
    }
  });

  socket.on("leave-room", (data) => {
    const room = chatRooms.get(data.roomId);
    if (room) {
      room.participants.delete(socket.id);
      socket.leave(data.roomId);
      
      // Notificar outros participantes
      socket.to(data.roomId).emit("user-left", {
        userName: users.get(socket.id)?.name
      });
      
      // Se a sala ficar vazia, remover
      if (room.participants.size === 0) {
        chatRooms.delete(data.roomId);
      }
      
      console.log(`🚪 ${users.get(socket.id)?.name} saiu da sala ${room.name}`);
    }
  });

  socket.on("room-message", (data) => {
    // Transmitir mensagem para todos na sala
    socket.to(data.roomId).emit("room-message", {
      from: users.get(socket.id)?.name,
      fromAvatar: users.get(socket.id)?.avatar,
      text: data.text,
      timestamp: new Date().toISOString()
    });
  });

  // Solicitar dados do dashboard
  socket.on("get-dashboard-data", () => {
    const onlineUsers = Array.from(users.values()).filter(user => user.online);
    const today = new Date().toDateString();
    const callsToday = persistentData.calls.filter(call => 
      new Date(call.timestamp).toDateString() === today
    ).length;
    
    const missedCalls = persistentData.calls.filter(call => 
      !call.answered && new Date(call.timestamp).toDateString() === today
    ).length;

    socket.emit("dashboard-data", {
      onlineUsers: onlineUsers.length,
      totalUsers: users.size,
      callsToday: callsToday,
      missedCalls: missedCalls,
      activeRooms: chatRooms.size,
      recentCalls: persistentData.calls
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 5)
    });
  });

  // Solicitar lista de salas ativas
  socket.on("get-active-rooms", () => {
    const roomsList = Array.from(chatRooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      creator: room.creatorName,
      participants: room.participants.size,
      createdAt: room.createdAt
    }));
    
    socket.emit("active-rooms", roomsList);
  });

  // Desconexão
  socket.on("disconnect", () => {
    console.log("🔴 Usuário desconectado:", socket.id);
    
    // Atualizar status para offline
    if (users.has(socket.id)) {
      const user = users.get(socket.id);
      user.online = false;
      user.lastSeen = new Date().toISOString();
    }
    
    // Encerrar chamada se estiver ativa
    if (activeCalls.has(socket.id)) {
      const remoteId = activeCalls.get(socket.id);
      const target = io.sockets.sockets.get(remoteId);
      if (target) {
        target.emit("webrtc-endcall");
        target.emit("call-ended");
      }
      activeCalls.delete(socket.id);
      activeCalls.delete(remoteId);
    }

    // Sair de todas as salas
    chatRooms.forEach((room, roomId) => {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        socket.to(roomId).emit("user-left", {
          userName: users.get(socket.id)?.name
        });
        
        // Se a sala ficar vazia, remover
        if (room.participants.size === 0) {
          chatRooms.delete(roomId);
        }
      }
    });

    if (users.has(socket.id)) {
      const user = users.get(socket.id);
      users.delete(socket.id);
      unreadMessages.delete(user.name);
    }
    
    // Salvar dados ao desconectar
    savePersistentData();
    
    broadcastUserList();
  });

  function broadcastUserList() {
    const userList = Array.from(users.values()).map(user => ({
      ...user,
      avatar: userAvatars.get(user.name) || null
    }));
    io.emit("user-list", userList);
  }
});

// Função para gerar ID da sala
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Inicialização do servidor
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📊 Dados persistentes carregados: ${Object.keys(persistentData).length} entradas`);
});

// Salvar dados periodicamente (a cada 5 minutos)
setInterval(() => {
  savePersistentData();
  console.log('💾 Dados salvos automaticamente');
}, 5 * 60 * 1000);