var app = require("express")();
app.use(require("body-parser").json());

const dotenv = require('dotenv');
dotenv.config();

const fetch = require("node-fetch");

const rolimonsToken = process.env.token;
const robloxId = process.env.robloxId;
const config = require("./config.json");

let itemValues = {};
let playerInv = {};
let onHold = [];

// Function for getting item values from rolimons.
async function getValues() {
  await fetch(`https://api.rolimons.com/items/v1/itemdetails`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  }).then((res) => res.json()).then((json) => {
    for (const item in json.items) {
      let type = json.items[item][5] >= 0 ? json.items[item][5] : 0;
      itemValues[item] = { value: Math.abs(json.items[item][4]), type: type };
    }
    getInv();
  }).catch((err) => {
    console.log(err);
  });
}

// Function for getting your inventory and seeing items on hold.
async function getInv() {
  await fetch(`https://api.rolimons.com/players/v1/playerassets/${robloxId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  }).then((res) => res.json()).then((json) => {
    playerInv = json.playerAssets;
    onHold = json.holds;
    generateAd();
  }).catch((err) => {
    console.log(err);
  });
}

// Algorithm to generate possible trade ads.
function findValidPairs(items, min, max) {
  const validPairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sum = items[i].value + items[j].value;
      if (sum > min && sum < max) {
        validPairs.push([items[i], items[j]]);
      }
    }
  }
  return validPairs;
}

// Function to decide what items to put in the ad.
function generateAd() {
  let availableItems = [];
  for (const asset in playerInv) {
    for (const uaid of playerInv[asset]) {
      if (!onHold.includes(uaid) && itemValues[asset]) {
        const itemValue = itemValues[asset].value;
        if (itemValue >= config.minItemValue && config.maxItemValue >= itemValue && !config.sendBlacklist.includes(`${asset}`)) {
          availableItems.push(asset);
        }
      } else {
        console.log(`Undefined itemValues for asset: ${asset}`);
      }
    }
  }

  let sendingSideNum = Math.floor(Math.random() * (config.maxItemsSend - config.minItemsSend + 1)) + config.minItemsSend;
  let sendingSide = [];
  for (let i = 0; i < sendingSideNum; i++) {
    let item = availableItems[Math.floor(Math.random() * availableItems.length)];
    sendingSide.push(parseFloat(item));
    availableItems.splice(availableItems.indexOf(item), 1);
  }

  if (config.smartAlgo) {
    let receivingSide = [];
    let totalSendValue = 0;
    for (const item of sendingSide) {
      if (itemValues[item]) {
        totalSendValue += itemValues[item].value;
      } else {
        console.log(`Undefined itemValues for sending item: ${item}`);
      }
    }

    let upgOrDown = Math.floor(Math.random() * 2);
    if (upgOrDown === 1) {
      let requestValue = totalSendValue * (1 - config.RequestPercent / 100);
      let options = [];
      for (const item in itemValues) {
        if (itemValues[item].value >= requestValue && itemValues[item].value <= totalSendValue && itemValues[item].type >= config.minDemand && !sendingSide.includes(parseFloat(item))) {
          options.push(item);
        }
      }

      if (options.length >= 1) {
        let item = options[Math.floor(Math.random() * options.length)];
        receivingSide.push(parseFloat(item), "upgrade", "adds");
        postAd(sendingSide, receivingSide);
      } else {
        receivingSide.push("adds");
        let itemIdValArr = [];
        for (const item in itemValues) {
          if (itemValues[item].type >= config.minDemand) {
            itemIdValArr.push({ id: item, value: itemValues[item].value });
          }
        }

        let validPairs = findValidPairs(itemIdValArr, totalSendValue * (1 - config.RequestPercent / 100), totalSendValue);
        if (validPairs.length > 0) {
          const randomPair = validPairs[Math.floor(Math.random() * validPairs.length)];
          const ids = randomPair.map((item) => item.id);
          for (const id of ids) {
            receivingSide.push(parseFloat(id));
          }
          determineUpgradeOrDowngrade(sendingSide, receivingSide);
        } else {
          console.log("No valid pairs found.");
          generateAd();
        }
      }
    } else {
      handleDowngrade(sendingSide, totalSendValue);
    }
  } else {
    // Adding manual item selection soon
  }
}

function handleDowngrade(sendingSide, totalSendValue) {
  let receivingSide = ["adds"];
  let itemIdValArr = [];
  for (const item in itemValues) {
    if (itemValues[item].type >= config.minDemand) {
      itemIdValArr.push({ id: item, value: itemValues[item].value });
    }
  }

  let validPairs = findValidPairs(itemIdValArr, totalSendValue * (1 - config.RequestPercent / 100), totalSendValue);
  if (validPairs.length > 0) {
    const randomPair = validPairs[Math.floor(Math.random() * validPairs.length)];
    const ids = randomPair.map((item) => item.id);
    for (const id of ids) {
      receivingSide.push(parseFloat(id));
    }
    determineUpgradeOrDowngrade(sendingSide, receivingSide);
  } else {
    console.log("No valid pairs found.");
    generateAd();
  }
}

function determineUpgradeOrDowngrade(sendingSide, receivingSide) {
  let maxRValue = Math.max(...receivingSide.filter(item => typeof item === 'number').map(item => itemValues[`${item}`].value || 0));
  let maxSValue = Math.max(...sendingSide.filter(item => typeof item === 'number').map(item => itemValues[`${item}`].value || 0));

  if (maxSValue < maxRValue) {
    receivingSide.push("upgrade");
  } else {
    receivingSide.push("downgrade");
  }
  postAd(sendingSide, receivingSide);
}

// Function for actually posting the trade ad
async function postAd(sending, receiving) {
  let allRTags = [];
  let allRIds = [];
  console.log("Giving:", sending, "requesting", receiving);

  for (const tag of receiving) {
    if (typeof tag === "string") {
      allRTags.push(tag);
    } else if (typeof tag === "number") {
      allRIds.push(tag);
    }
  }

  let seenStrings = new Set();
  const result = allRTags.filter(item => {
    if (typeof item === 'string') {
      if (seenStrings.has(item)) {
        return false;
      }
      seenStrings.add(item);
    }
    return true;
  });

  let reqBody = {
    "player_id": parseFloat(robloxId),
    "offer_item_ids": sending,
    "request_item_ids": allRIds,
    "request_tags": result
  };
  console.log(reqBody);

  fetch(`https://api.rolimons.com/tradeads/v1/createad`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cookie": `${rolimonsToken}`
    },
    body: JSON.stringify(reqBody),
  }).then((res) => res.json()).then((json) => {
    console.log(json);
  }).catch((err) => {
    console.log(err);
  });

  setTimeout(function () {
    getValues();
  }, 1560000);
}

getValues();

app.get("/", (req, res) => {
  res.json({ message: 'Trade ad bot is up and running!' });
});
app.listen(8080);
