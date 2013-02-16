# mineflayer-scaffold

A library to help your mineflayer bot get to a specific point, even if it has
to dig or build to get there.

[YouTube Demo](http://youtu.be/jkg6psMUSE0)

See [https://github.com/superjoe30/mineflayer/](https://github.com/superjoe30/mineflayer/)

This plugin depends on
[mineflayer-navigate](https://github.com/superjoe30/mineflayer-navigate).

## Usage

```js
var mineflayer = require('mineflayer');
var navigatePlugin = require('mineflayer-navigate')(mineflayer);
var scaffoldPlugin = require('mineflayer-scaffold')(mineflayer);
var bot = mineflayer.createBot();
navigatePlugin(bot);
scaffoldPlugin(bot);
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
  }
});
```
