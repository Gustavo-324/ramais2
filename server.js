const express = require("express");
const http = require("http");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);

const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, "public")));

const users = new Map();
const chatMessages = new Map();
const unreadMessages = new Map();

// Rota principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat.html"));
});

// Socket.io
io.on("connection", (socket) => {
  console.log("🟢 Novo usuário conectado:", socket.id);

  // Registro
  socket.on("register", (payload) => {
    users.set(socket.id, { 
      name: payload.name, 
      online: true, 
      socketId: socket.id 
    });
    unreadMessages.set(payload.name, new Map());
    broadcastUserList();
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
        timestamp: new Date().toISOString()
      };
      
      chatMessages.get(chatKey).push(message);
      
      // Envia mensagem para o destinatário
      targetSocket.emit("chatMessage", message);
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
  });

  // Desconexão
  socket.on("disconnect", () => {
    console.log("🔴 Usuário desconectado:", socket.id);
    
    if (users.has(socket.id)) {
      const user = users.get(socket.id);
      users.delete(socket.id);
      unreadMessages.delete(user.name);
    }
    
    broadcastUserList();
  });

  function broadcastUserList() {
    const userList = Array.from(users.values());
    io.emit("user-list", userList);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`💬 Sistema de Chat WebRTC`);
});