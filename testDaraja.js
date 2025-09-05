// testDaraja.js
const { stkPush } = require("./payments/daraja");

(async () => {
  const response = await stkPush("254708374149", 100);
  console.log(response);
})();
