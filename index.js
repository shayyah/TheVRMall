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
//var sockets = [];//todo

MongoClient.connect(url, { useNewUrlParser: true }, function (err, db) {
  console.log('mongodb connected  '+url);
  if (err) return;
  var dbo = db.db("heroku_pvhp5txw");
  console.log(dbo);

  io.on('connection', function (socket) {
    //sockets.push(socket);
    var curId = socket.id;
    var myId;

    console.log('user connected:' + curId);
    socket.emit('connected');
	//dsadssa
    socket.on('registration', function (data) {//The user ask for registration
      console.log(data);
      checkValidId(data.id, function (player) {
        if (player == null) {
          savePlayerInDB(data, socket.id, function (player) {
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
          console.log('player  info   '+player.name+ "  "+player.owners);
          myId = player.id;
          var query = { id: player.id };
          var newvalues = { $set: { online: true, roomid:'',socketId:socket.id }, $push: { socketIds: socket.id }};

          dbo.collection("user").updateOne(query, newvalues, function (err, res) {
            if (err){
              console.log(err);
              return;
            }
            console.log("1 document updated");
              console.log('player login: ' + player.name+'   '+player.id);
              player.online=true;
              player.roomid='';
              player.socketIds.push(curId);
              player.socketId=socket.id;
            socket.emit('loginDone', player);
            //dfsdfds
          });
        }
        else{
          console.log('go to register');
           savePlayerInDB(data, curId, function (Myplayer) {
            console.log('player register: ' + Myplayer.name+'   '+Myplayer.id+'    '+JSON.stringify(Myplayer));
            myId = Myplayer.id;
            socket.emit('register', Myplayer);
        });
      }

    });
    });

    socket.on('search', function (data) {//Parameter: send the name you are searching for
      checkValidId(myId, function (myPlayer) {
        getSearchedFor(data.name, function (searchResult) {
            console.log("this is the search result: " + searchResult);
            socket.emit('searchResult', { searchResult: searchResult } );
        });
      });
    });
     socket.on('searchbyid', function (data) {//Parameter: send the name you are searching for
      checkValidId(myId, function (myPlayer) {
        checkValidId(data.name, function (store) {
          console.log(store);
            if(store!=null)
              socket.emit('searchResultbyid', store );
        });
      });
    });
    socket.on('addFriend', function (data) {//Parametere: send the id of the added friend
      checkValidId(data.id, function (player) {
        checkValidId(myId, function (myPlayer) {
          isBlocked(myPlayer.id, player.id, function (blocked) {
              if (!blocked) {
                console.log('notBlocked');
                addNewFriend(myId,myPlayer.name, player.id,player.name);
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
        checkValidId(data.recieverId, function (reciever) {
          console.log('sendMessage');
          socket.emit('messagesent',{'status':'done'});
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
                  checkValidId(group.members[i].id, function (player) {
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
    socket.on('updateName',function(data){
          checkValidId(myId, function (myPlayer) {
              if(myPlayer!=null)
              {
                  changePlayerName(myId,data.name);
                  socket.emit('updateNameDone',{status:'done'});
              }
          });
      });
    socket.on('getUnreadMessages', function (data) {//TEST again
      checkValidId(myId, function (myPlayer) {
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
      checkValidId(myId, function (myPlayer) {
        updateMessageState(data.id, myPlayer);
      });
    });

    socket.on('friendRequestHandler', function (data) {//Parameter: send the id of the friend and the status of the request

      checkValidId(data.id,function(other){
        checkValidId(myId,function(myPlayer){


            if(other!=null&&myPlayer!=null){
                handleFriendRequest(myId, data.id, data.status);

                console.log(data.status);
                socket.emit('friendRequestResponse', { status: data.status });
                if (data.status == true||data.status == 'true') {
                  console.log(JSON.stringify(other));
                  other.socketIds.forEach(element => {//todo
                    console.log(element);
                      io.to(element).emit('yourFriendRequestResponse',myPlayer);
                    });
                }
              }
        });
      });
    });

    socket.on('removeFriend', function (data) {//Parameter: send the id of the removed friend
    checkValidId(myId, function (myPlayer) {
      checkValidId(data.id, function (player) {
        removeFriendship(myId, data.id);
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
      checkValidId(myId, function(myPlayer) {
      checkValidId(data.id, function (player) {
    //    console.log('wwwwww1');
        //removeFriendship(myPlayer, player);
    //      console.log('wwwwww2');
        blockUser(myId, data.id);
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
      checkValidId(data.id, function (player) {
      checkValidId(myId, function (myPlayer) {
        isBlocked(myId, player.id, function (blocked) {
          if (blocked) {
            unblockUser(myId, player.id);

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
      socket.on('checkping',function(data){
        console.log('checkping');
          socket.emit('ping',{'status':'true'});
      });
    socket.on('createRoom',function (data){
      console.log('createRoom')
        console.log(JSON.stringify(data));
        checkValidId(myId,function(player){

            CreateRoom(data.name,data.membersInvited,data.usersInRoom,true,function(room){
               AddUserToRoom(room.id,player,function(newroom){
                 console.log('sentCreate   '+JSON.stringify(newroom.membersInvited));
                 io.to(curId).emit('createdroom',newroom);
                  for(var i=0;i<newroom.membersInvited.length;i++){
                      if(newroom.membersInvited[i].id==player.id)
                      {
                        console.log('memberCreatedGroup');

                      }
                      else{
                          checkValidId(newroom.membersInvited[i].id,function(other){
                              io.to(other.socketId).emit('roominvitation',newroom);
                          });
                      }
                   }
              });
            });

        });

    });
    socket.on('askforRooms',function(data){
      checkValidId(data.id,function(player){
        //console.log('askforRooms  '+player.name +'   '+rooms.length);
        if(player!=null){
          getPublicRooms(function(rooms){


                  for(var i=0;i<rooms.length;i++)
                  {

                    if(rooms[i].isprivate==true){
                      console.log('room  '+rooms[i].name+'   '+rooms[i].membersInvited.length);
                      for(var j=0;j<rooms[i].membersInvited.length;j++)
                      {
                        if(rooms[i].membersInvited[j].id==player.id)
                        {
                          socket.emit('roominvitation',rooms[i]);
                        }

                      }
                    }
                  }
            });
        }
      });

    });
    socket.on('updateClothes',function(data){
        updatePlayerClothes(data);

    });
    socket.on('askForPlayerClothes',function(data){
      console.log(myId+'  askforClothes  '+data.id);
      checkValidId(data.id,function(player){
        console.log(player.clothes);
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
        checkValidId(myId,function(player){

            //console.log(player);
            getPublicRooms(function(rooms){

                  var done=false;
                    if(rooms!=null){
          //  console.log(rooms.length);
                        for(var i=0;i<rooms.length;i++)
                        {
                            if(rooms[i].usersInRoom.length<10)
                            {
                                AddUserToRoom(rooms[i].id,player,function(newroom){
                                  updatePlayerClothes(data);
                                      console.log('added to room   '+JSON.stringify(newroom));
                                  io.to(curId).emit('joinRoomDone',newroom);


                                  });
                              done=true;
                               break;
                            }
                        }
                  }
                    if(!done)
                    {


                   //     console.log(JSON.stringify(room));
                    //    console.log('11 '+JSON.stringify(player));
                        CreateRoom(player.name,[],[],false,function(newroom){
                    //       console.log('22 '+JSON.stringify(player));
                            AddUserToRoom(newroom.id,player,function(nroom){
                       //        console.log('33 '+JSON.stringify(player));
                              updatePlayerClothes(data);
                                console.log('created room   '+JSON.stringify(nroom));
                             io.to(curId).emit('joinRoomDone',nroom);

                            });

                        });
                    }
              });
        });

    });

    socket.on('acceptInvitation',function(data){
      checkValidId(myId,function(player){
        getRoomById(data.id,function(room){

            AddUserToRoom(room.id,player,function(nroom){
                 io.to(curId).emit('joinRoomDone',nroom);
               });

      });

    });
  });
    socket.on('moveInMall',function(data){
      //console.log('move   '+data);
      checkValidId(data.id,function(player){
        if(player.roomid!=null)
        {
         // var simpleUser=toSimpleUserMove(player);
      //   console.log(player.roomid);
           getRoomById(player.roomid,function(room){
              if(room!=null){
            //   console.log(player.id+'   '+room.usersInRoom.length);
                 for(var i=0;i<room.usersInRoom.length;i++)
                 {
                   if(room.usersInRoom[i].id!=player.id)
                    io.to(room.usersInRoom[i].socketId).emit('MoveInfo',data);
                 }
               }

           });

        }

    });

    });
    socket.on('leaveRoom',function(data){
        checkValidId(data.id,function(player){
            LeaveRoom(player);
        });
    });
    socket.on('disconnect', function () {//The user closed the app (disconnected)..
      console.log('removing user: ' + curId);
      checkValidId(myId, function (player) {
          console.log(JSON.stringify(player));
          if(player!=null)
          {
            if(player.roomid!='')
            {
              LeaveRoom(player);
            console.log('leaveDRoom');
            }
            disconnection(player, socket.id);
          }
      });
    });

  });

  function CreateRoom(rname,rmembersInvited,rusersInRoom,risPrivate,callback)
  {
    var room={
                        id:shortid.generate(),
                        name:rname,
                        membersInvited:rmembersInvited,
                        usersInRoom:rusersInRoom,
                        isprivate:risPrivate
                };

    addRoomTodataBase(room,function(newroom){
        callback(newroom);
    });



  }
  function addRoomTodataBase(newroom,callback)
  {
    dbo.collection('rooms').insertOne(newroom,function(err,res){
        if(err)callback(null);
        console.log('room inserted  '+res);
        callback(newroom);
    });
  }
  function LeaveRoom(user)
  {

    RemouveUserFromRoom(user.roomid,user,function(room){
      var query = { id: user.id };
          var newvalues = { $set: { roomid: '' } };
          dbo.collection("user").updateOne(query, newvalues, function (err, res) {
            if (err) return;
        });
        if(room!=null)
        {
            var simpleUser=toSimpleUserMove(user);
          for(var j=0;j<room.usersInRoom.length;j++)
          {
                io.to(room.usersInRoom[j].socketId).emit('playerLeaveRoom',simpleUser);
          }
        }

    });




  }


  function toSimpleUserMove(user)
  {
    var SimpleUserMove={
       id:user.id,
       name:user.name,
       position:user.position,
       rotation:user.position,
       socketId:user.socketId
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
  function RemouveUserFromRoom(roomid,user,callback)
  {
    console.log('remouveUserFromGroup'  +user);
    var query={id:roomid};
  //  var simpleUser=toSimpleUserMove(user);
    var newValue={$pull:{usersInRoom:{id:user.id}}};
    dbo.collection('rooms').updateOne(query,newValue,function(err,res){
      if(err)console.log(err);

      dbo.collection('rooms').findOne(query,function(err1,res1){
              if(err)console.log(err);
              else{
                if(res1.usersInRoom.length==0)
                {
                  var del={id:roomid};
                    dbo.collection('rooms').deleteOne(del);
                    callback(null);
                }
                else {
                  callback(res1);
                }

              }
      })

    });
  }
  function AddUserToRoom(roomId,user,callback)
  {
      var simpleUser=toSimpleUserMove(user);
    console.log(JSON.stringify(simpleUser)+" adddd  "+roomId);

    addUserToRoomData(roomId,simpleUser,function(room){
        console.log('useeeeeer aded   '+JSON.stringify(room));

        //  console.log('room id  '+rooms[i].id);
          user.roomid=roomId;
          var query = { id: user.id };
          var newvalues = { $set: { roomid: user.roomid } };
          dbo.collection('user').updateOne(query, newvalues, function (err, res) {
            if (err) return;

          //console.log('simpleUserMove  '+simpleUser);
             for(var j=0;j< room.usersInRoom.length;j++)
            {
               if(room.usersInRoom[j].id!=user.id)
               {

                       io.to(room.usersInRoom[j].socketId).emit('newUserAddedToRoom',simpleUser);

                     //io.to(user.socketId).emit('newUserAddedToRoom',rooms[i].usersInRoom[j]);
                }
             }
             callback(room);
          });
        });
  }
  function getRoomById(id,callback)
  {
    var query={id:id};
    dbo.collection('rooms').findOne(query,function(err,res){
        if(err)callback(null);
        callback(res);
    });
  }
  function getPublicRooms(callback)
  {
    var query={isprivate:false};
    dbo.collection('rooms').find(query).toArray(function(err,res){
        if(err)callback(null);
        callback(res);
    });
  }
  function addUserToRoomData(id,user,callback)
  {
      var query={id:id};
      var newValue={$push:{usersInRoom:user}};
      dbo.collection('rooms').updateOne(query,newValue,function(err,res){
        if(err)callback(null);
      //  console.log(res);
        dbo.collection('rooms').findOne(query,function(err1,res1){
          if(err1)callback(null);
          callback(res1);
        });
      });
  }

  function getPlayer(id, callback) {
    var query = { id: id };
    var player = null;
    dbo.collection('user').findOne(query, function (err, user) {
        if(err||user==null||user==undefined){
            console.log(err);
            console.log(user);
              callback(null);
        }
        else{  console.log(user);
          player = user;
          getAllFriends(player.id,function(friends){
              player.friends=friends;
                getAllRequest(player.id,function(requestsRecieved){
                    player.requestsRecieved=requestsRecieved;
                      getAllRequestsSent(player.id,function(requestsSent){
                          player.requestsSent=requestsSent;
                          getAllBlocks(player.id,function(blocks){
                            player.blocks=blocks;
                                getAllBlockedBy(player.id,function(blockedBy){
                                    player.blockedBy=blockedBy;
                                    console.log('ppppppp  '+JSON.stringify(player));
                                    callback(player);

                                })
                          });


                      });

                });
          });


        //  player.blocks= getAllBlocks(player.id);
      //    player.blockedBy= getAllBlockedBy(player.id);


      }
    });
  }
  async function getAllFriends(id,callback)
  {
    var query = { firstId:id,state:'friend' };
    var query2 = { secondId:id,state:'friend' };
    var ans=await dbo.collection('friendData').find(query).toArray();
    var ans2=await dbo.collection('friendData').find(query2).toArray();

      var allAns=[];
    if(ans!=null){
        for(var i=0;i<ans.length;i++){
            allAns.push({id:ans[i].secondId,name:ans[i].secondName});
        }
    }
    if(ans2!=null)
    {
      for(var i=0;i<ans2.length;i++){
          allAns.push({id:ans2[i].firstId,name:ans[i].firstName});
      }
    }
      callback(allAns);

  }
  async function getAllBlocks(id,callback)
  {
    var query = { firstId:id,state:'block' };
    var ans=await dbo.collection('friendData').find(query).toArray();
    var allAns=[];
    if(ans!=null){
        for(var i=0;i<ans.length;i++){
            allAns.push({id:ans[i].secondId,name:ans[i].secondName});
        }
    }
      callback(allAns);

  }
  async function getAllBlockedBy(id,callback)
  {
    var query = { secondId:id,state:'block' };
    var ans=await dbo.collection('friendData').find(query).toArray();
    var allAns=[];
    if(ans!=null){
        for(var i=0;i<ans.length;i++){
            allAns.push({id:ans[i].firstId,name:ans[i].firstName});
        }
    }
      callback(allAns);

  }

  async function getAllRequest(id,callback)
  {
    var query = { secondId:id,state:'request' };
    var ans=await dbo.collection('friendData').find(query).toArray();
    var allAns=[];

    console.log('ans   '+JSON.stringify(ans)+'   '+ans.length);
    if(ans!=null){
        for(var i=0;i<ans.length;i++){
            allAns.push({id:ans[i].firstId,name:ans[i].firstName});
        }
    }
console.log(allAns.length);
      callback(allAns);

  }
  async function getAllRequestsSent(id,callback)
  {
    var query = { firstId:id,state:'request' };
    var ans=await dbo.collection('friendData').find(query).toArray();

    var allAns=[];
    if(ans!=null){

        for(var i=0;i<ans.length;i++){
            allAns.push({id:ans[i].secondId,name:ans[i].secondName});
        }
    }
    console.log(allAns.length);
    console.log('query done  '+JSON.stringify(ans));
      callback(allAns);


  }

  function updatePlayerClothes(player)
  {
    console.log('updateClothes   '+player.clothes);
    var query = { id: player.id };
    var newvalues = { $set: { clothes: player.clothes } };
    dbo.collection('user').updateOne(query, newvalues, function (err, res) {
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
      socketId:socketId,
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
      clothes:'',
      isStore:(player.isStore!=null?player.isStore:false)
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
    checkValidId(recieverId, function (reciever) {
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
    dbo.collection("user").find(query).toArray(function (err, res) {//TODO: exclude the users who has stores
      if (err) return;
      for (var i = 0; i < res.length; i++) {

          result.push(res[i]);

      }
      callback(result);
    });
  }

  function isBlocked(myPlayerId, otherId, callback) {

      var query = {firstId:myPlayerId,secondId:otherId,state:'block'};
      dbo.collection("friendData").findOne(query,function(err,res){
            if(err||res==null||res=={})
            {
                query.firstId=otherId;
                query.secondId=myPlayerId;
                  dbo.collection("friendData").findOne(query,function(err,res){
                          if(err||res==null||res=={})
                              callback(false);
                          else callback(true);
                  });
            }
            else callback(true);
      });

  }


  function addNewFriend(myId, myName,otherId,otherName)
  {
      var request={
        id:shortid.generate(),
        firstId:myId,
        firstName:myName,
        secondId:otherId,
        secondName:otherName,
        state:'request'
      };
      dbo.collection("friendData").insertOne(request, function (err, res) {
        if (err) return;
        console.log("1 request inserted: " + request);

      });
  }
  function handleFriendRequest(myId, otherId, status) {
    //Remove request from my list.. I am the reciever

    var query={firstId:otherId,secondId:myId,state:'request'};
    console.log(JSON.stringify(query));
    var newvalues={state:'deleted'};
    if(status=='true'||status==true)
        newvalues={state:'friend'};
    console.log(JSON.stringify(newvalues));
    dbo.collection("friendData").updateOne(query,newvalues,function(err,res){
      if(err)console.log(err);
    //  else console.log(res);
    console.log('update friend done');
    });


  }



  function removeFriendship(myId, otherId) {

      //Remove friendship from my list
      var query = { firstId:myId,secondId:otherId };
      var newdata={state:'deleted'};
      dbo.collection("friendData").findOne(query,function(err,res){
          if(err||res==null||res=={})
          {
                query = { firstId:otherId,secondId:myId };
          }
          dbo.collection("friendData").updateOne(query,newdata,function(err,res){
            if(err)console.log(err);
            else console.log(res);
          })
      });
  }

  function blockUser(myId, otherId) {

      var query = { firstId: myId,secondId:otherId };
      var newvalues = { state:'block' };
      dbo.collection("friendData").findOne(query,function (err, res) {
        if (err||res==null||res=={})
        {
            query = { firstId: otherId,secondId:myId };
            newvalues={firstId:myId,secondId:otherId,state:'block'};
        }
        dbo.collection("friendData").updateOne(query,newdata,function(err,res){
          if(err)console.log(err);
          else console.log(res);
        })
      });


  }

  function unblockUser(myId, otherId) {
    var query = { firstId: myId,secondId:otherId };
    var newvalues = { state:'' };

      dbo.collection("friendData").updateOne(query,newdata,function(err,res){
        if(err)console.log(err);
        else console.log(res);
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
        checkValidId(group.members[i].id, function (player) {
          addGroupToMember(group, player);
        });
      }
      callback(group);
    });
  }

  function addGroupToMember(group, player) {
    var query = { id: player.id };
    var newvalues = { $push: { groups: { id: group.id, name: group.name } } };
    dbo.collection(player.owners == undefined ? "user" : "store").updateOne(query, newvalues, function (err, res) {
      if (err) return;
      console.log("1 group inserted to user: " + player.name);
    });
  }

  function addMemberToGroup(group, memberId, callback) {
    getPlayer(memberId, function (player) {
      var query = { id: group.id };
      var newvalues = { $push: { members: { id: player.id, name: player.name } } };
      dbo.collection("group").updateOne(query, newvalues, function (err, res) {
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
  function checkValidId(id,callback)
  {
    dbo.collection("user").findOne({id:id}, function (err, res) {
      if (err) callback(null);
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
          dbo.collection(player.owners == undefined ? "user" : "store").updateOne(query, newvalues, function (err, res) {
              if (err) return;
                console.log("1 group removed from user: " + player.name);
              });
            }

      function changePlayerName(myPlayerId,newName)
      {
        var query={id:myPlayerId};
        var newdata={name:newName};
        dbo.collection('user').updateOne(query,newdata,function(err,res){
          if(err)return;
          console.log('update name done  '+res);
          var query1={firstId:myPlayerId};
          var newdata1={firstName:newName};
          var query2={secondId:myPlayerId};
          var newdata2={secondName:newName};
          dbo.collection('friendData').update(query1,newdata1,function(err, res) {
              if(err) return;
              console.log('11 update');
          });
          dbo.collection('friendData').update(query2,newdata2,function(err, res) {
              if(err) return;
              console.log('22 update');
          });
        });
      }
  function disconnection(player,socketId) {
  //    arrayRemove(sockets, socketId);
    var query = { id: player.id };
    var newvalues = {
      $set: { online: false, lastOnline: new Date()},
      $pull: { socketIds: socketId }
    };
    dbo.collection("user").updateOne(query, newvalues, function (err, res) {
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
