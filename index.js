var EventEmitter = require('events').EventEmitter
  , assert = require('assert')

module.exports = init;

// instantiated from init
var vec3;
var sideVecs;
var materials;

// block types allowed to be used as scaffolding
var scaffoldBlockTypes = {
  3:  true, // dirt
  4:  true, // cobblestone
  87: true, // netherrack
};

var liquidBlockTypes = {
  8: true,  // water
  9: true,  // water
  10: true, // lava
  11: true, // lava
};

var fallingBlockTypes = {
  12: true, // sand
  13: true, // gravel
};

function init(mineflayer) {
  vec3 = mineflayer.vec3;
  sideVecs = [
    vec3(-1,  0,  0),
    vec3( 1,  0,  0),
    vec3( 0, -1,  0),
    vec3( 0,  1,  0),
    vec3( 0,  0, -1),
    vec3( 0,  0,  1),
  ];
  materials = mineflayer.materials;
  return inject;
}

function inject(bot) {
  bot.scaffold = new EventEmitter();
  bot.scaffold.state = 'off';
  bot.scaffold.targetPoint = null;
  bot.scaffold.stop = stop;
  bot.scaffold.to = to;
  bot.scaffold.resume = resume;

  var onStop = noop;

  var navigateTimeout;

  var cleanups = [];
  // just a reference to bot.scaffold.targetPoint because it
  // is cumbersome to type
  var targetPoint;

  bot.on('death', function() {
    changeState('off', 'death');
  });

  var transition = {
    walk: function () {
      // try to get to destination block
      var results = bot.navigate.findPathSync(targetPoint, { timeout: navigateTimeout, });

      // we don't even care if it worked. just get close and then re-evaluate.
      var done = false;
      bot.navigate.walk(results.path, function() {
        if (done) return;
        done = true;
        moveToBlockCenter();
        changeState('improvePosition');
      });
      changeState('walking');
      cleanups.push(function() {
        if (done) return;
        done = true;
        bot.navigate.stop();
        moveToBlockCenter();
      });
    },
    off: noop,
    walking: noop,
    falling: noop,
    equipBuildingBlock: noop,
    jumping: noop,
    equipTool: noop,
    digging: noop,
    improvePosition: function () {
      moveToBlockCenter();
      // start with Y
      var flooredY = Math.floor(bot.entity.position.y);
      if (flooredY < targetPoint.y) {
        changeState('increaseY');
        return;
      }
      if (flooredY > targetPoint.y) {
        changeState('decreaseY');
        return;
      }
      // we're at the correct Y. Now X.
      improveX();
    },
    increaseX: function () {
      if (Math.floor(bot.entity.position.x) >= targetPoint.x) return changeState('walk');
      moveInDirection(vec3(1, 0, 0));
    },
    decreaseX: function () {
      if (Math.floor(bot.entity.position.x) <= targetPoint.x) return changeState('walk');
      moveInDirection(vec3(-1, 0, 0));
    },
    increaseY: function () {
      var groundBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (!bot.entity.onGround) {
        // we're falling. nothing to do except wait.
        var done = false;
        setTimeout(function() {
          if (done) return;
          done = true;
          changeState('improvePosition');
        }, 500);
        changeState('falling');
        cleanups.push(function() {
          if (done) return;
          done = true;
        });
        return;
      }
      if (Math.floor(bot.entity.position.y) >= targetPoint.y) return changeState('walk');
      // check if the ceiling is clear to jump
      for (var y = 2; y <= 4; ++y) {
        var ceiling = bot.blockAt(bot.entity.position.offset(0, y, 0));
        if (ceiling.type !== 0) {
          breakBlock(ceiling, bot.scaffold.state);
          return;
        }
      }
      if (! equipBuildingBlock()) return;
      // jump and build a block down below
      bot.setControlState('jump', true);
      var targetBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      var jumpY = bot.entity.position.y + 1;
      bot.on('move', placeIfHighEnough);
      changeState('jumping');
      cleanups.push(function() {
        bot.removeListener('move', placeIfHighEnough);
        bot.setControlState('jump', false);
      });
      function placeIfHighEnough() {
        if (bot.entity.position.y > jumpY) {
          bot.placeBlock(targetBlock, vec3(0, 1, 0));
          changeState('increaseY');
        }
      }
    },
    decreaseY: function () {
      if (Math.floor(bot.entity.position.y) <= targetPoint.y) return changeState('walk');
      var groundBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (!bot.entity.onGround || groundBlock.boundingBox === 'empty') {
        // we're falling. nothing to do except wait.
        var done = false;
        setTimeout(function() {
          if (done) return;
          done = true;
          changeState('improvePosition');
        }, 500);
        changeState('falling');
        cleanups.push(function() {
          if (done) return;
          done = true;
        });
        return;
      }
      if (! groundBlock.diggable) {
        // let's try improving Z or X first.
        improveX();
        return;
      }
      // make sure when we dig the block below, we won't fall.
      var nextGroundBlock = bot.blockAt(bot.entity.position.offset(0, -2, 0));
      if (nextGroundBlock.boundingBox !== 'block') {
        if (nextGroundBlock.type === 0) {
          if (! placeBlock(groundBlock, vec3(0, -1, 0))) return;
        } else {
          breakBlock(nextGroundBlock, "decreaseY");
          return;
        }
      }
      // dig the block below
      breakBlock(groundBlock, 'decreaseY');
    },
    increaseZ: function () {
      if (Math.floor(bot.entity.position.z) >= targetPoint.z) return changeState('walk');
      moveInDirection(vec3(0, 0, 1));
    },
    decreaseZ: function () {
      if (Math.floor(bot.entity.position.z) <= targetPoint.z) return changeState('walk');
      moveInDirection(vec3(0, 0, -1));
    },
  };

  function stop() {
    changeState('off', 'stop');
  }

  function to(point, options, cb) {
    if (! cb) {
      cb = options;
      options = {};
    }

    var err = new Error('scaffold: interrupt');
    err.code = 'interrupt';
    onStop(err);
    onStop = cb || noop;
    options = options || {};
    navigateTimeout = options.navigateTimeout == null ? 3000 : options.navigateTimeout;
    bot.scaffold.targetPoint = targetPoint = point.floored();
    resume();
  }

  function resume() {
    if (bot.scaffold.state === 'off' || bot.scaffold.state === 'walking') {
      changeState('walk');
    }
  }

  function changeState(newState, reason, data) {
    var oldState = bot.scaffold.state;
    bot.scaffold.state = newState;
    cleanups.forEach(function(fn) { fn(); });
    cleanups = [];
    bot.scaffold.emit('changeState', oldState, newState, reason, data);
    if (newState === 'off') {
      if (reason === 'success') {
        onStop();
      } else {
        var err = new Error("scaffold: " + reason);
        err.code = reason;
        err.data = data;
        onStop(err);
      }
      onStop = noop;
    }
    transition[newState]();
  }
  function moveToBlockCenter() {
    bot.entity.velocity.set(0, bot.entity.velocity.y, 0);
    var centerPos = bot.entity.position.floored().offset(0.5, 0.5, 0.5);
    bot.entity.position.set(centerPos.x, bot.entity.position.y, centerPos.z);
  }
  function improveX() {
    moveToBlockCenter();
    var flooredX = Math.floor(bot.entity.position.x);
    if (flooredX < targetPoint.x) return changeState('increaseX');
    if (flooredX > targetPoint.x) return changeState('decreaseX');
    // we're at the correct Y and X. Now Z.
    var flooredZ = Math.floor(bot.entity.position.z);
    if (flooredZ < targetPoint.z) return changeState('increaseZ');
    if (flooredZ > targetPoint.z) return changeState('decreaseZ');
    // we are at the target point. mission accomplished.
    changeState('off', 'success');
  }
  function moveInDirection(dir) {
    // if the 3 blocks are in place such that we can move into the new
    // location, do it.
    var newPos = bot.entity.position.plus(dir);
    var floor = bot.blockAt(newPos.offset(0, -1, 0));
    var lower = bot.blockAt(newPos.offset(0, 0, 0));
    var upper = bot.blockAt(newPos.offset(0, 1, 0));
    if (lower.boundingBox !== 'empty') {
      breakBlock(lower, bot.scaffold.state);
    } else if (upper.boundingBox !== 'empty') {
      breakBlock(upper, bot.scaffold.state);
    } else if (floor.boundingBox === 'empty') {
      if (! equipBuildingBlock()) return;
      var myFloor = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (! placeBlock(myFloor, dir)) return;
      changeState('improvePosition');
    } else {
      var done = false;
      bot.navigate.walk([newPos], function(stopReason) {
        if (done) return;
        done = true;
        moveToBlockCenter();
        changeState('improvePosition');
      });
      changeState('walking');
      cleanups.push(function() {
        if (done) return;
        done = true;
        bot.navigate.stop();
        moveToBlockCenter();
      });
    }
  }
  function breakBlock(targetBlock, newState) {
    // before breaking, plug up any lava or water
    var dangerBlockAndVecs = sideVecs.map(function(sideVec) {
      return {
        block: bot.blockAt(targetBlock.position.plus(sideVec)),
        sideVec: sideVec,
      };
    }).filter(function(sideBlockAndVec) {
      return liquidBlockTypes[sideBlockAndVec.block.type];
    });
    for (var i = 0; i < dangerBlockAndVecs.length; ++i) {
      if (! placeBlock(targetBlock, dangerBlockAndVecs[i].sideVec)) return;
    }
    var aboveBlock = bot.blockAt(targetBlock.position.offset(0, 1, 0));
    var fallDanger = !!fallingBlockTypes[aboveBlock.type];

    if (! bot.canDigBlock(targetBlock) || fallDanger) {
      changeState('off', 'danger', targetBlock);
      return;
    }
    if (! equipToolToBreak(targetBlock)) return;
    var done = false;
    bot.dig(targetBlock, function(err) {
      if (done) return;
      done = true;
      if (err) {
        if (err.code === 'EDIGINTERRUPT') {
          changeState(newState);
        } else {
          changeState('off', 'errorDigging', err);
        }
      } else {
        changeState(newState);
      }
    });
    changeState('digging');
    cleanups.push(function() {
      if (done) return;
      done = true;
    });
  }
  function canHarvest(block) {
    var okTools = block.harvestTools;
    if (!okTools) return true;
    if (bot.heldItem && okTools[bot.heldItem.type]) return true;
    // see if we have the tool necessary in inventory
    var tools = bot.inventory.items().filter(function(item) {
      return okTools[item.type];
    });
    var tool = tools[0];
    return !!tool;
  }
  function equipToolToBreak(blockToBreak) {
    if (! canHarvest(blockToBreak)) {
      changeState('off', 'itemRequired', {
        types: blockToBreak.harvestTools,
        type: 'tool',
        targetBlock: blockToBreak,
      });
      return false;
    }
    // equip the most efficient tool that we have
    var material = blockToBreak.material;
    if (! material) return true;
    var toolMultipliers = materials[material];
    assert.ok(toolMultipliers);
    var tools = bot.inventory.items().filter(function(item) {
      return toolMultipliers[item.type] != null;
    });
    tools.sort(function(a, b) {
      return toolMultipliers[b.type] - toolMultipliers[a.type];
    });
    var tool = tools[0];
    if (!tool) return true;
    if (bot.heldItem && bot.heldItem.type === tool.type) return true;
    var done = false;
    bot.equip(tool, 'hand', function(err) {
      if (done) return;
      done = true;
      if (err) {
        changeState('off', 'errorEquipping', err);
      } else {
        changeState('improvePosition');
      }
    });
    changeState('equipTool');
    cleanups.push(function() {
      if (done) return;
      done = true;
    });
  }
  function placeBlock(referenceBlock, dir) {
    if (! equipBuildingBlock()) return false;
    bot.placeBlock(referenceBlock, dir);
    return true;
  }
  function equipBuildingBlock() {
    // return true if we're already good to go
    if (bot.heldItem && scaffoldBlockTypes[bot.heldItem.type]) return true;
    var scaffoldingItems = bot.inventory.items().filter(function(item) {
      return scaffoldBlockTypes[item.type];
    });
    var item = scaffoldingItems[0];
    if (!item) {
      changeState('off', 'itemRequired', {
        types: scaffoldBlockTypes,
        type: 'scaffolding',
      });
      return false;
    }
    var done = false;
    bot.equip(scaffoldingItems[0], 'hand', function(err) {
      if (done) return;
      done = true;
      if (err) {
        changeState('off', 'errorEquipping', err);
      } else {
        changeState('improvePosition');
      }
    });
    changeState('equipBuildingBlock');
    cleanups.push(function() {
      if (done) return;
      done = true;
    });
  }
}

function noop() {}
