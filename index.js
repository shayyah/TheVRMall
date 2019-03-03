var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

var url = process.env.MONGODB_URI || process.env.MONGOHQ_URL || "mongodb://localhost:27017/";
var shortid=require('short-id');
var port = process.env.PORT || 3000;
server.listen(port,function(){
  console.log('server started on port   '+port+'    '+url);
});



//myserver

app.get('/', function (req, res) {
  res.send('server working good   '+port);
});
var sockets = [];//todo
MongoClient.connect(url, { useNewUrlParser: true }, function (err, db) {
  console.log('mongodb connected  '+url);
  if (err) return;
  var dbo = db.db("heroku_pvhp5txw");
  console.log(dbo);
  var rooms=[];
  io.on('connection', function (socket) {
    sockets.push(socket);
    var curId = socket.id;
    var myId;

    console.log('user connected:' + curId);
    socket.emit('connected');

    socket.on('registration', function (data) {//The user ask for registration
      console.log(data);
      getPlayer(data.id, function (player) {
        if (player == null) {
          savePlayerInDB(data, curId, function (player) {
            console.log('player register: ' + player.name);
            myId = player.id;
            socket.emit('register', player);//Tell the user that he registered successfully, and give him his data
          });
        } else {
          console.log('player: ' + player.name + ' already registered');
        }
      });
    });

    socket.on('login', function (data) {
      console.log('player login: ' + data.name);
      getPlayer(data.id, function (player) {
        if (player != null) {
          console.log('player  info   '+player.name);
          myId = player.id;
          var query = { id: player.id };
          var newvalues = { $set: { online: true },$set:{ roomid : ''}, $push: { socketIds: socket.id }};
          dbo.collection(player.owners == undefined ? "user" : "store").updateOne(query, newvalues, function (err, res) {
            if (err) return;
            console.log("1 document updated");
              console.log('player login: ' + player.name+'   '+player.id);
              player.online=true;
              player.roomid='';
              player.socketIds.push(socket.id);
            socket.emit('loginDone', player);
          });
        }
        else{
          console.log('go to register');
           savePlayerInDB(data, curId, function (player) {
            console.log('player register: ' + player.name+'   '+player.id);
            myId = player.id;
            socket.emit('register', player);
        });
      }

    });
    });
    socket.on('search', function (data) {//Parameter: send the name you are searching for
      getPlayer(myId, function (myPlayer) {
        getSearchedFor(data.name, function (searchResult) {
            console.log("this is the search result: " + searchResult);
            socket.emit('searchResult', { searchResult: searchResult } );
        });
      });
    });
     socket.on('searchbyid', function (data) {//Parameter: send the name you are searching for
      getPlayer(myId, function (myPlayer) {
        getPlayer(data.name, function (store) {
          console.log(store);
            if(store!=null)
              socket.emit('searchResultbyid', store );
        });
      });
    });
    socket.on('addFriend', function (data) {//Parametere: send the id of the added friend
      getPlayer(data.id, function (player) {
        getPlayer(myId, function (myPlayer) {
          isBlocked(myPlayer, player, function (blocked) {
              if (!blocked) {
                console.log('notBlocked');
                sendRequest(myId, player);
                player.socketIds.forEach(element => {//todo
                  io.to(element).emit('newFriendRequest', myPlayer);
                });
            }
          });
        });
      });
    });

    socket.on('sendMessage', function (data) {
      console.log('message from : ' + data.senderId + ' to: ' + data.recieverId + ' content: ' + data.content);
      saveMessageInDB(data.senderId, data.recieverId, data.content, function (message) {
        getPlayer(data.recieverId, function (reciever) {
          console.log('sendMessage');

          if(reciever != null && reciever.online) {
            console.log('userrrr');
            reciever.socketIds.forEach(element => {
            io.to(element).emit('newMessage', message);
            });
            updateMessageState(reciever.id,reciever);
          }
          else if(reciever==null) {//If the reciever id is a group: get the group object then send the message to all its members
              console.log('grouppppp');
            getGroup(data.recieverId, function (group) {
              for (var i = 0; i < group.members.length; i++) {
                if(myId != group.members[i].id) {
                  getPlayer(group.members[i].id, function (player) {
                    player.socketIds.forEach(element => {//todo
                    io.to(element).emit('newMessage', message);
                  });
                  });
                }
              }
            });
          }
        });
      });
    });

    socket.on('getUnreadMessages', function (data) {//TEST again
      getPlayer(myId, function (myPlayer) {
        getMessages(data.id, myPlayer, function (messages) {
          for (var i = 0; i < messages.length; i++) {
            myPlayer.socketIds.forEach(element => {//todo
              io.to(element).emit('newMessage', messages[i]);
            });
          }
          updateMessageState(data.id, myPlayer);
        });
      });
    });

    socket.on('openChat', function (data) {//Parameter: send the id of the opened user chat (not my id)
      getPlayer(myId, function (myPlayer) {
        updateMessageState(data.id, myPlayer);
      });
    });

    socket.on('friendRequestHandler', function (data) {//Parameter: send the id of the friend and the status of the request
      getPlayer(data.id, function (player) {
        getPlayer(myId, function (myPlayer) {
          handleFriendRequest(myPlayer, player, data.status);
          var request = {//TOEDIT
            requestHandler: player,
            status: data.status
          };

          io.to(curId).emit('friendRequestResponse', { status: data.status });
          if (data.status == true||data.status == 'true') {

            player.socketIds.forEach(element => {//todo
                io.to(element).emit('yourFriendRequestResponse',myPlayer);
              });
          }
        });
      });
    });

    socket.on('removeFriend', function (data) {//Parameter: send the id of the removed friend
    getPlayer(myId, function (myPlayer) {
      getPlayer(data.id, function (player) {
        removeFriendship(myPlayer, player);
        player.socketIds.forEach(element => {//todo
          io.to(element).emit('UserRemovedYou', myPlayer);
        });
        //io.to(player.socketId).emit('UserBlockedYou', myPlayer);
        myPlayer.socketIds.forEach(element => {//todo
          io.to(element).emit('OnRemoveUserDone', player);
        });
        //io.to(myPlayer.socketId).emit('OnBlockUserDone', player);
      });
    });
    console.log('==========\n');
  });

    socket.on('block', function (data) {//Parameter: send the id of the user to block
    //  console.log('wwwwww');
      getPlayer(myId, function(myPlayer) {
      getPlayer(data.id, function (player) {
    //    console.log('wwwwww1');
        removeFriendship(myPlayer, player);
    //      console.log('wwwwww2');
        blockUser(myId, player);
    //      console.log('wwwwww3');
        player.socketIds.forEach(element => {//todo
              io.to(element).emit('UserBlockedYou', myPlayer);
            });
    //        console.log('wwwwww4');
           // var smypl={id:myPlayer.id,name=myPlayer.name};
            //var spl={id:player.id,name=player.name};

          io.to(curId).emit('OnBlockUserDone',player);

      });
    });
    });

    socket.on('removeBlock', function (data) {//Parameter: send the id of the user to remove block
      getPlayer(data.id, function (player) {
      getPlayer(myId, function (myPlayer) {
        isBlocked(myPlayer, player, function (blocked) {
          if (blocked) {
            unblockUser(myId, player);

            player.socketIds.forEach(element => {//todo
              io.to(element).emit('blockRemoved', myPlayer);
            });
              io.to(curId).emit('UnblockUserDone',player);

          }
        });
      });
    });
    });
    socket.on('createGroup', function (data) {//Parameter: send the full group object
      console.log(JSON.stringify(data));
      createGroup(data, function (group) {
        for (var i = 0; i < group.members.length; i++) {
          getPlayer(group.members[i].id, function (player) {
            if(player.online){
              player.socketIds.forEach(element => {//todo
                  io.to(element).emit('joinedGroup', group);
                });
            }
           });
          }
          });

        });
    socket.on('getGroup', function (data) {//Parameter: send the groupId
        getPlayer(myId, function (myPlayer) {
          getGroup(data.groupId, function (group) {
              io.to(curId).emit('getGroup', group);
          });
        });
        console.log('==========\n');
      });

    socket.on('addMemberToGroup', function (data) {//Parameter: send the new member id and the group id
      getGroup(data.groupId, function (group) {
      addMemberToGroup(group, data.memberId, function (player) {
        player.socketIds.forEach(element => {//todo
                    io.to(element).emit('joinedGroup', group);
                  });
        });
      });
    });
    socket.on('removeMemberFromGroup', function (data) {//Parameter: send the new member id and the group id
        getGroup(data.groupId, function (group) {
          removeMemberFromGroup(group, data.memberId, function (player) {
            player.socketIds.forEach(element => {//todo
              io.to(element).emit('removedFromGroup', group);
            });
            getGroup(data.groupId,function(newgroup){
                newgroup.members.forEach(user=>{
                  getPlayer(user.id,function(other){
                    other.socketIds.forEach(element => {//todo
                      io.to(element).emit('GroupUpdated', newgroup);
                    });
                  });
                });

            });
            //io.to(player.socketId).emit('joinedGroup', group);
          });
        });
        console.log('==========\n');
      });
    socket.on('createRoom',function (data){
      console.log('createRoom')
        console.log(JSON.stringify(data));
        getPlayer(myId,function(player){

            CreateRoom(data,function(room){
               AddUserToRoom(room,player,function(newroom){
                 console.log('sentCreate   '+JSON.stringify(newroom.membersInvited.length));

                  for(var i=0;i<newroom.membersInvited.length;i++){
                      if(newroom.membersInvited[i].id==player.id)
                      {
                        console.log('memberCreatedGroup');
                        io.to(curId).emit('createdroom',newroom);
                      }
                      else{
                          getPlayer(newroom.membersInvited[i].id,function(other){
                            other.socketIds.forEach(element => {//todo
                              io.to(element).emit('roominvitation',newroom);
                            });

                          });
                      }
                   }
              });
            });

        });

    });
    socket.on('askforRooms',function(data){
      getPlayer(data.id,function(player){
        console.log('askforRooms  '+player.name +'   '+rooms.length);
        for(var i=0;i<rooms.length;i++)
        {

          if(rooms[i].isprivate==true){
            console.log('room  '+rooms[i].name+'   '+rooms[i].membersInvited.length);
          for(var j=0;j<rooms[i].membersInvited.length;j++)
          {
              if(rooms[i].membersInvited[j].id==player.id)
              {
                io.to(curId).emit('roominvitation',rooms[i]);
              }

          }
          }
        }

      });

    });
    socket.on('updateClothes',function(data){
        updatePlayerClothes(data);

    });
    socket.on('askForPlayerClothes',function(data){
      console.log('askforClothes  ');
      getPlayer(data.id,function(player){
          if(player.clothes!=null)
          {
            console.log(player.clothes);
            socket.emit('PlayerClothes',player);

          }

      });

    });
    socket.on('joinRandomGroup',function(data){
       console.log('joinRandomGroup')
      // console.log(JSON.stringify(data));
        getPlayer(myId,function(player){

            var done=false;
            //console.log(player);
          //  console.log(rooms.length);
            for(var i=0;i<rooms.length;i++)
            {
                if(!rooms[i].isprivate&&rooms[i].usersInRoom.length<20)
                {
                    AddUserToRoom(rooms[i],player,function(newroom){
                      updatePlayerClothes(data);
                      io.to(curId).emit('joinRoomDone',newroom);


                  });
                  done=true;
                   break;
                }
            }
            if(!done)
            {

                var room={
                        id:shortid.generate(),
                        name:player.name,
                        membersInvited:[],
                        usersInRoom:[],
                        isprivate:false
                };
           //     console.log(JSON.stringify(room));
            //    console.log('11 '+JSON.stringify(player));
                CreateRoom(room,function(newroom){
            //       console.log('22 '+JSON.stringify(player));
                    AddUserToRoom(newroom,player,function(nroom){
               //        console.log('33 '+JSON.stringify(player));
                      updatePlayerClothes(data);
                //        console.log(JSON.stringify(nroom));
                     io.to(curId).emit('joinRoomDone',nroom);

                    });

                });
            }

        });

    });
    socket.on('acceptInvitation',function(data){
      getPlayer(myId,function(player){
        for(var i=0;i<rooms.length;i++){
          if(rooms[i].id==data.id)
          {
            AddUserToRoom(rooms[i],player,function(nroom){
                 io.to(curId).emit('joinRoomDone',nroom);
            });
            break;
          }
        }
      });

    });
    socket.on('moveInMall',function(data){
      //console.log('move   '+data);
      getPlayer(data.id,function(player){
        if(player.roomid!=null)
        {
         // var simpleUser=toSimpleUserMove(player);
           var room= getRoom(player.roomid);
           for(var i=0;i<room.usersInRoom.length;i++)
           {
             if(room.usersInRoom[i].id!=player.id)
              io.to(room.usersInRoom[i].socketId).emit('MoveInfo',data);
           }
        }

    });

    });
    socket.on('leaveRoom',function(data){
        getPlayer(data.id,function(player){
            LeaveRoom(player);
        });
    });
    socket.on('disconnect', function () {//The user closed the app (disconnected)..
      console.log('removing user: ' + curId);
      getPlayer(myId, function (player) {
          console.log(JSON.stringify(player));
        if(player.roomid!='')
             LeaveRoom(player);
          console.log('leaveDRoom');
          disconnection(player, socket.id);
      });
    });

  });
  function CreateRoom(newroom,callback)
  {
    var room={
                        id:shortid.generate(),
                        name:newroom.name,
                        membersInvited:newroom.membersInvited,
                        usersInRoom:newroom.usersInRoom,
                        isprivate:newroom.isprivate
                };

      rooms.push(room);

      callback(room);

  }
  function LeaveRoom(user)
  {

    RemouveUserFromRoom(user.roomid,user);
    var roomId=user.roomid;

    user.roomid="";
      var query = { id: user.id };
          var newvalues = { $set: { roomid: '' } };
          dbo.collection("user").updateOne(query, newvalues, function (err, res) {
            if (err) return;
            var simpleUser=toSimpleUserMove(user);
            console.log('roomId   '+roomId);
      for(var i=0;i<rooms.length;i++)
      {
        if(rooms[i].id==roomId)
        {
            for(var j=0;j<rooms[i].usersInRoom.length;j++)
            {
                  io.to(rooms[i].usersInRoom[j].socketId).emit('playerLeaveRoom',simpleUser);
            }
            break;
        }
      }
          });
  }

  function getRoom(id)
  {
    for(var i=0;i<rooms.length;i++)
    {
      if(rooms[i].id==id)
        return rooms[i];
    }
    return null;
  }
  function toSimpleUserMove(user)
  {
    var SimpleUserMove={
       id:user.id,
       name:user.name,
       position:user.position,
       rotation:user.position,
       socketId:(user.socketids!=null&&user.socketids[0]!=null)?user.socketids[0]:''
     };
     return SimpleUserMove;

  }
  function toSimpleUser(user)
  {
     var simpleUser={
       id:user.id,
       name:user.name
     };
     return simpleUser;
  }
  function RemouveUserFromRoom(roomid,user)
  {
    console.log('remouveUserFromGroup   '  +roomid);
    console.log(JSON.stringify(user));
    for(var i=0;i<rooms.length;i++)
    {
      if(rooms[i].id==roomid)
      {
         console.log(rooms[i].usersInRoom.length);
        for(var j=0;j<rooms[i].usersInRoom.length;j++)
          {
              if(rooms[i].usersInRoom[j].id==user.id)
              {

                console.log(JSON.stringify(rooms[i]));
                   rooms[i].usersInRoom.splice(j,1);
                   break;
              }
          }
           console.log(rooms[i].usersInRoom.length);
          if(rooms[i].usersInRoom.length==0)
          {
            rooms.splice(i,1);
          }
          break;
      }
    }
    console.log(rooms.length);
  }
  function AddUserToRoom(room,user,callback)
  {
    console.log(room.id+"   "+rooms.length);
    for(var i=0;i<rooms.length;i++)
    {
      if(rooms[i].id==room.id)
      {

          console.log(rooms[i].id);
          user.roomid=rooms[i].id;
          var query = { id: user.id };
          var newvalues = { $set: { roomid: user.roomid } };
          dbo.collection("user").updateOne(query, newvalues, function (err, res) {
            if (err) return;
              var simpleUser=toSimpleUserMove(user);
          //console.log('simpleUserMove  '+simpleUser);
             rooms[i].usersInRoom.push(simpleUser);
             console.log(rooms[i].usersInRoom.length);
             for(var j=0;j< rooms[i].usersInRoom.length;j++)
            {
               if(rooms[i].usersInRoom[j].id!=user.id)
               {
                   getPlayer( rooms[i].usersInRoom[j].id,function(other){
                     other.socketIds.forEach(element => {//todo
                       io.to(element).emit('newUserAddedToRoom',simpleUser);
                     });

                     });
                     //io.to(user.socketId).emit('newUserAddedToRoom',rooms[i].usersInRoom[j]);
                }
             }
          callback(rooms[i]);
          });

          break;
      }
    }
  }

  function getPlayer(id, callback) {
    var query = { id: id };
    var player = null;
    dbo.collection("user").findOne(query, function (err, user) {
      if (user != null) {
     //   console.log('get user: ' + user.name);
        player = user;
      }
      dbo.collection("store").findOne(query, function (err, store) {
        if (store != null) {
          console.log('get store: ' + store.name);
          player = store;
        }
        callback(player);
      });
    });
  }
  function updatePlayerClothes(player)
  {
    console.log('updateClothes   '+player.clothes);
    var query = { id: player.id };
    var newvalues = { $set: { clothes: player.clothes } };
    dbo.collection("user").updateOne(query, newvalues, function (err, res) {
      if (err) return;
    });

  }
  function savePlayerInDB(player, socketId, callback) {

    var pos ={
      x:0,
      y:0,
      z:0,
      w:0,
      mallid:''
    };
    var userToSave = {
      id: player.id,
      name: player.name,
      socketIds: [],
      online: true,
      lastOnline: new Date(),
      groups: [],
      blocks: [],
      friends: [],
      blockedBy: [],
      requestsSent: [],
      requestsRecieved: [],
      position : pos,
      roomid :'',
      clothes:''
    };
    console.log(socketId);
    userToSave.socketIds.push(socketId);
    console.log('end init  '+userToSave.name);
    dbo.collection("user").insertOne(userToSave, function (err, res) {
      console.log(err);
      if (err) console.log(err);
      console.log("(1) user inserted: " + userToSave.name);
      if (player.isStore == true) {
        var storeToSave = userToSave;
        storeToSave.owners = [{
          id: userToSave.id,
          name: userToSave.name
        }];
        dbo.collection("store").insertOne(storeToSave, function (err, res) {
          if (err) return;
          console.log("(1) store inserted: " + storeToSave.name);
          callback(storeToSave);
        });
      }
      else callback(userToSave);
    });


  }

  function getMessages(id, myPlayer, callback) {//SalimEdition
 //   var query = {
//      $or: [//I am the sender AND he is the reciever OR vice versa
//            { recieverId: id, senderId: myPlayer.id },
//            { senderId: id, recieverId: myPlayer.id }
//          ],
 //       seen: false
 //   };
    var query = { recieverId: id, date: { $gt: myPlayer.lastOnline } };
    var messages;
    dbo.collection("message").find(query).toArray(function (err, res) {
      if (err) return;
      console.log("messages are:");
      console.log(res);
      messages = res;
      callback(messages);
    });
  }

  function saveMessageInDB(senderId, recieverId, content, callback) {
    var isOnline = false;
    getPlayer(recieverId, function (reciever) {
      if (reciever != null) {
        isOnline = reciever.online;
      }
      //Insert the message to the DB
      var message = {
        senderId: senderId,
        recieverId: recieverId,
        seen: isOnline,
        content: content,
        date: new Date()
      };
      dbo.collection("message").insertOne(message, function (err, res) {
        if (err) return;
        console.log("1 message inserted: " + message.content);
        callback(message);
      });
    });
  }

  function updateMessageState(id, player) {//TEST again SalimEdition
    var myquery = {  recieverId: player.id, seen: false };
    var newvalues = { $set: { seen: true } };
    dbo.collection("message").updateMany(myquery, newvalues, function (err, res) {
      if (err) return;
      console.log(res.result.nModified + " document(s) updated");
    });
  }

  function getSearchedFor(name, callback) {
    var query = { name: { $regex : ".*" + name + ".*" } };
    var result = [];
    dbo.collection("store").find(query).toArray(function (err, res) {
      if (err) return;
      for (var i = 0; i < res.length; i++) {
        result.push(res[i]);
      }
    });
    dbo.collection("user").find(query).toArray(function (err, res) {//TODO: exclude the users who has stores
      if (err) return;
      for (var i = 0; i < res.length; i++) {
        if (result.filter(obj => { return obj.id == res[i].id }).length == 0) {
          result.push(res[i]);
        }
      }
      callback(result);
    });
  }

  function isBlocked(myPlayer, player, callback) {
    //Temporary by salim

    var iBlockedHim = myPlayer.blocks.find(function (user) {
      return user.id == player.id;
    }) == undefined ? false : true;

    var heBlockedMe = player.blocks.find(function (user) {
      return user.id == myPlayer.id;
    }) == undefined ? false : true;

    if (iBlockedHim || heBlockedMe) {
      callback(true, myPlayer);
    } else {
      callback(false, myPlayer);
    }
  }

  function sendRequest(myId, player) {
    getPlayer(myId, function (myPlayer) {
      //Update my requestsSent list
      var query = { id: myPlayer.id };

      var newvalues = { $push: { requestsSent: { id: player.id, name: player.name } } };
      dbo.collection(myPlayer.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 requestsSent inserted");
      });

      //Update their requestsRecieved list
      var query2 = { id: player.id };
      var newvalues2 = { $push: { requestsRecieved: { id: myPlayer.id, name: myPlayer.name } } };
      dbo.collection(player.owners == undefined ? "user" : "store").update(query2, newvalues2, function (err, res) {
        if (err) return;
        console.log("1 requestsRecieved inserted");
      });
    });
  }

  function handleFriendRequest(myPlayer,  player, status) {
    //Remove request from my list.. I am the reciever
    var query = { id: myPlayer.id };
    var newvalues = { $pull: { requestsRecieved: { id: player.id, name: player.name } } };
    dbo.collection(myPlayer.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
      if (err) return;
      console.log("1 friendshipRecieved removed");
    });

    //Remove request from their list.. they are the senders
    var query = { id: player.id };
    var newvalues = { $pull: { requestsSent: { id: myPlayer.id, name: myPlayer.name } } };
    dbo.collection(player.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
      if (err) return;
      console.log("1 requestSent removed");
    });

    if (status) {
      addFriend(myPlayer, player);
    }
  }

  function addFriend(myPlayer, player) {
    //Update my friends list
    var query = { id: myPlayer.id };
    var newvalues = { $push: { friends: { id: player.id, name: player.name } } };
    dbo.collection(myPlayer.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
      if (err) return;
      console.log("1 friendship inserted");
    });
    //Update their friends list
    query = { id: player.id };
    newvalues = { $push: { friends: { id: myPlayer.id, name: myPlayer.name } } };
    dbo.collection(player.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
      if (err) return;
      console.log("1 friendship inserted");
    });
  }

  function removeFriendship(myPlayer, player) {

      //Remove friendship from my list
      var query = { id: myPlayer.id };
      var newvalues = { $pull: { friends: { id: player.id, name: player.name } } };
      dbo.collection(myPlayer.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 friendship removed");
      });

      //Remove friendship from their list
      var query = { id: player.id };
      var newvalues = { $pull: { friends: { id: myPlayer.id, name: myPlayer.name } } };
      dbo.collection(player.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 friendship removed");
      });

  }

  function blockUser(myId, player) {
    getPlayer(myId, function (myPlayer) {

      //Update my friends list
      var query = { id: myPlayer.id };
      var newvalues = { $push: { blocks: { id: player.id, name: player.name } } };
      dbo.collection(myPlayer.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 block inserted");
      });
      //Update their friends list
      query = { id: player.id };
      newvalues = { $push: { blockedBy: { id: myPlayer.id, name: myPlayer.name } } };
      dbo.collection(player.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 blockedBy inserted");
      });
    });
  }

  function unblockUser(myId, player) {
    getPlayer(myId, function (myPlayer) {

      //Remove block from my list
      var query = { id: myPlayer.id };
      var newvalues = { $pull: { blocks: { id: player.id, name: player.name } } };
      dbo.collection(myPlayer.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 block removed");
      });

      //Remove blockedBy from their list
      var query = { id: player.id };
      var newvalues = { $pull: { blockedBy: { id: myPlayer.id, name: myPlayer.name } } };
      dbo.collection(player.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 blockedBy removed");
      });
    });
  }

  function createGroup(group, callback) {
    //Insert the new group
    group.id = shortid.generate();
    console.log(group.name+'    '+group.id);
    dbo.collection('group').insertOne(group, function (err, res) {
      if (err) return;
      group = res.ops[0];
      console.log("1 group inserted");
      for (var i = 0; i < group.members.length; i++) {
        getPlayer(group.members[i].id, function (player) {
          addGroupToMember(group, player);
        });
      }
      callback(group);
    });
  }

  function addGroupToMember(group, player) {
    var query = { id: player.id };
    var newvalues = { $push: { groups: { id: group.id, name: group.name } } };
    dbo.collection(player.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
      if (err) return;
      console.log("1 group inserted to user: " + player.name);
    });
  }

  function addMemberToGroup(group, memberId, callback) {
    getPlayer(memberId, function (player) {
      var query = { id: group.id };
      var newvalues = { $push: { members: { id: player.id, name: player.name } } };
      dbo.collection("group").update(query, newvalues, function (err, res) {
        if (err) return;
        console.log("1 user added to group");
        addGroupToMember(groupId, player);
        callback(player);
      });
    });
  }

  function getGroup(groupId, callback) {
    var query = { id: groupId };
    console.log(query);
    dbo.collection("group").findOne(query, function (err, res) {
      if (err) return;
      callback(res);
    });
  }
  function removeMemberFromGroup(group, memberId, callback) {
      getPlayer(memberId, function (player) {
        var query = { id: group.id };
        var newvalues = { $pull: { members: { id: player.id, name: player.name } } };
        dbo.collection("group").update(query, newvalues, function (err, res) {
          if (err) return;
          console.log("1 user removed from group");
          removeGroupFromMember(group, player);
          callback(player);
        });
      });
    }
    function removeGroupFromMember(group, player) {
        var query = { id: player.id };
          var newvalues = { $pull: { groups: { id: group.id, name: group.name } } };
          dbo.collection(player.owners == undefined ? "user" : "store").update(query, newvalues, function (err, res) {
              if (err) return;
                console.log("1 group removed from user: " + player.name);
              });
            }
  function disconnection(player,socketId) {
      arrayRemove(sockets, socketId);
    var query = { id: player.id };
    var newvalues = {
      $set: { online: false, lastOnline: new Date() },
      $pull: { socketIds: socketId }
    };
    dbo.collection(player.owners == undefined ? "user" : "store").updateOne(query, newvalues, function (err, res) {
      if (err) return;
      console.log("1 document updated");
    });
  }
  function arrayRemove(arr, value) {
    return arr.filter(function(ele){
        return (ele.socketId == value) ? false : true;
    });
  }
});
