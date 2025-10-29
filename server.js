const express = require("express");
const http = require("http");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);

const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: '50mb' }));

const users = new Map();
const activeCalls = new Map();
const chatMessages = new Map();
const unreadMessages = new Map();
const userAvatars = new Map();

// Rota principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat.html"));
});

// Socket.io
io.on("connection", (socket) => {
  console.log("🟢 Novo usuário conectado:", socket.id);

  // Registro
  socket.on("register", (payload) => {
    const userData = {
      name: payload.name, 
      online: true, 
      socketId: socket.id,
      avatar: userAvatars.get(payload.name) || payload.avatar || null
    };
    
    users.set(socket.id, userData);
    unreadMessages.set(payload.name, new Map());
    
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
      
      // Envia atualização de mensagens não lidas
      targetSocket.emit("unread-update", Array.from(unreadMessages.get(data.targetName) || []));
      socket.emit("unread-update", Array.from(unreadMessages.get(data.from) || []));
    }
  });

  // Solicitar mensagens não lidas
  socket.on("get-unread-messages", (userName) => {
    const userUnread = unreadMessages.get(userName);
    if (userUnread) {
      socket.emit("unread-update", Array.from(userUnread));
    }
  });

  // WebRTC
  socket.on("webrtc-offer", (data) => {
    const target = io.sockets.sockets.get(data.toSocketId);
    if (target) {
      activeCalls.set(socket.id, data.toSocketId);
      activeCalls.set(data.toSocketId, socket.id);
      target.emit("webrtc-offer", { 
        fromSocketId: socket.id, 
        fromName: data.fromName, 
        sdp: data.sdp 
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
      // Também fecha para quem está ligando
      socket.emit("call-ended");
    }
    activeCalls.delete(socket.id);
    activeCalls.delete(data.toSocketId);
    console.log(`❌ Chamada recusada para ${data.toSocketId}`);
  });

  socket.on("webrtc-endcall", (data) => {
    const target = io.sockets.sockets.get(data.toSocketId);
    if (target) {
      target.emit("webrtc-endcall");
      // Também fecha para quem está ligando
      socket.emit("call-ended");
    }
    activeCalls.delete(socket.id);
    activeCalls.delete(data.toSocketId);
    console.log(`📞 Chamada encerrada entre ${socket.id} e ${data.toSocketId}`);
  });

  // Desconexão
  socket.on("disconnect", () => {
    console.log("🔴 Usuário desconectado:", socket.id);
    
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

    if (users.has(socket.id)) {
      const user = users.get(socket.id);
      users.delete(socket.id);
      unreadMessages.delete(user.name);
    }
    
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});