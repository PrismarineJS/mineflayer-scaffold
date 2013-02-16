var mineflayer = require('mineflayer');
var vec3 = mineflayer.vec3;
var navigatePlugin = require('mineflayer-navigate')(mineflayer);
var scaffoldPlugin = require('../')(mineflayer);
var bot = mineflayer.createBot();
navigatePlugin(bot);
scaffoldPlugin(bot);
bot.scaffold.on('changeState', function(oldState, newState, reason, data) {
  console.log(oldState, "->", newState);
});
bot.on('chat', function(username, message) {
  if (username === bot.username) return;
  var target = bot.players[username].entity;
  if (message === 'come') {
    bot.scaffold.to(target.position, function(err) {
      if (err) {
        bot.chat("didn't make it: " + err.code);
      } else {
        bot.chat("made it!");
      }
    });
  } else {
    var match = message.match(/^goto\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*$/);
    if (match) {
      var pt = vec3(
        parseFloat(match[1], 10),
        parseFloat(match[2], 10),
        parseFloat(match[3], 10));
      bot.scaffold.to(pt);
    } else {
      console.log("no match");
    }
  }
});
