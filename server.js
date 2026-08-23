const express=require('express');const http=require('http');const {Server}=require('socket.io');const crypto=require('crypto');
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.static('public'));
const rooms=new Map();
function id(n=6){return crypto.randomBytes(n).toString('hex')}
function getRoom(code){if(!rooms.has(code)) rooms.set(code,{publicMessages:[],privateMessages:new Map(),users:new Map(),privateToken:id(16)});return rooms.get(code)}
function cleanMessage(m){return {id:m.id,userId:m.userId,name:String(m.name||'Guest').slice(0,40),text:String(m.text||'').slice(0,5000),time:m.time,replyTo:m.replyTo||null}}
io.on('connection',s=>{
 s.on('join',({roomCode,userId,name,privateToken})=>{roomCode=String(roomCode||'').slice(0,40);if(!roomCode)return;const r=getRoom(roomCode);const privateAccess=privateToken===r.privateToken;s.data={roomCode,userId:String(userId||id(8)),name:String(name||'Guest').slice(0,40),privateAccess};r.users.set(s.id,{userId:s.data.userId,name:s.data.name,privateAccess});s.join(roomCode);s.emit('state',{publicMessages:r.publicMessages,privateMessages:privateAccess?(r.privateMessages.get(r.privateToken)||[]):[],privateAccess,privateToken:r.privateToken,users:[...r.users.values()].map(x=>({userId:x.userId,name:x.name,privateAccess:x.privateAccess}))});io.to(roomCode).emit('users',[...r.users.values()].map(x=>({userId:x.userId,name:x.name,privateAccess:x.privateAccess})));});
 s.on('public:message',raw=>{const d=s.data;if(!d?.roomCode)return;const r=getRoom(d.roomCode);const m=cleanMessage({...raw,userId:d.userId,name:d.name,id:id(8),time:Date.now()});r.publicMessages.push(m);if(r.publicMessages.length>500)r.publicMessages.shift();io.to(d.roomCode).emit('public:message',m)});
 s.on('private:message',raw=>{const d=s.data;if(!d?.roomCode||!d.privateAccess)return;const r=getRoom(d.roomCode);const m=cleanMessage({...raw,userId:d.userId,name:d.name,id:id(8),time:Date.now()});let arr=r.privateMessages.get(r.privateToken)||[];arr.push(m);if(arr.length>500)arr.shift();r.privateMessages.set(r.privateToken,arr);for(const [sid,u] of r.users){if(u.privateAccess)io.to(sid).emit('private:message',m)}});
 s.on('disconnect',()=>{const d=s.data;if(!d?.roomCode)return;const r=rooms.get(d.roomCode);if(!r)return;r.users.delete(s.id);io.to(d.roomCode).emit('users',[...r.users.values()].map(x=>({userId:x.userId,name:x.name,privateAccess:x.privateAccess})));});
});
app.get('/api/room/:code',(req,res)=>{const r=getRoom(req.params.code);res.json({privateToken:r.privateToken})});
const PORT=process.env.PORT||5000;server.listen(PORT,'0.0.0.0',()=>console.log('ShareClone 2 running on '+PORT));
