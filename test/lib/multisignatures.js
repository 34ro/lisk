"use strict";

// Requires and node configuration
var async = require("async");
var node = require("./../variables.js");

var totalMembers = node.randomNumber(2, 16);
var requiredSignatures = node.randomNumber(2, totalMembers + 1);

var NoLISKAccount = node.randomAccount();
NoLISKAccount.name = "nolisk";

var MultisigAccount = node.randomAccount();
MultisigAccount.name = "multi";

var Accounts = [];
for (var i = 0; i < totalMembers; i++) {
    Accounts[i] = node.randomAccount();
}

var MultiSigTX = {
    lifetime: 0,
    min: 0,
    members: [],
    txId: ""
}

// Used for opening accounts
var accountOpenTurn = 0;

function openAccount (account, i, done) {
    node.api.post("/accounts/open")
        .set("Accept", "application/json")
        .send({
            secret: account.password,
            secondSecret: account.secondPassword
        })
        .expect("Content-Type", /json/)
        .expect(200)
        .end(function (err, res) {
            if (i != null) {
                // console.log("Opening Account " + i + " with password: " + account.password);
            }
            node.expect(res.body).to.have.property("success").to.be.true;
            if (res.body.account && i != null) {
                Accounts[i].address = res.body.account.address;
                Accounts[i].publicKey = res.body.account.publicKey;
            } else if (account.name == "nolisk") {
                NoLISKAccount.address = res.body.account.address;
                NoLISKAccount.publicKey = res.body.account.publicKey;
            } else if (account.name == "multi") {
                MultisigAccount.address = res.body.account.address;
                MultisigAccount.publicKey = res.body.account.publicKey;
            }
            done();
        });
}

// Used for sending LISK to accounts
var accountSendTurn = 0;

function sendLISK (account, i, done) {
    var randomLISK = node.randomLISK();

    node.api.put("/transactions")
        .set("Accept", "application/json")
        .send({
            secret: node.Gaccount.password,
            amount: randomLISK,
            recipientId: account.address
        })
        .expect("Content-Type", /json/)
        .expect(200)
        .end(function (err, res) {
            // console.log(JSON.stringify(res.body));
            // console.log("Sending " + randomLISK + " LISK to " + account.address);
            node.expect(res.body).to.have.property("success").to.be.true;
            if (res.body.success && i != null) {
                Accounts[i].balance = randomLISK / node.normalizer;
            }
            done();
        });
}

function sendLISKfromMultisigAccount (amount, recipient, done) {
    node.api.put("/transactions")
        .set("Accept", "application/json")
        .send({
            secret: MultisigAccount.password,
            amount: amount,
            recipientId: recipient
        })
        .expect("Content-Type", /json/)
        .expect(200)
        .end(function (err, res) {
            // console.log(JSON.stringify(res.body));
            // console.log("Sending " + amount + " LISK to " + recipient);
            node.expect(res.body).to.have.property("success").to.be.true;
            node.expect(res.body).to.have.property("transactionId");
            done(err, res.body.transactionId);
        });
}

function confirmTransaction (transactionId, passphrases, done) {
    var count = 0;

    async.until(
        function () {
            return (count >= passphrases.length);
        },
        function (untilCb) {
            var passphrase = passphrases[count];

            node.api.post("/multisignatures/sign")
              .set("Accept", "application/json")
              .send({
                  secret: passphrase,
                  transactionId: transactionId
              })
              .expect("Content-Type", /json/)
              .expect(200)
              .end(function (err, res) {
                  // console.log(JSON.stringify(res.body));
                  node.expect(res.body).to.have.property("success").to.be.true;
                  node.expect(res.body).to.have.property("transactionId").to.eql(transactionId);
                  count++;
                  return untilCb();
              });
        },
        function (err) {
            done(err);
        }
    );
}

// Used for KeysGroup
var Keys;

function makeKeysGroup () {
    var keysgroup = [];
    for (var i = 0; i < totalMembers; i++) {
        var member = "+" + Accounts[i].publicKey;
        keysgroup.push(member);
    }
    return keysgroup;
}

before(function (done) {
    async.series([
        function (seriesCb) {
            var i = 0;
            async.eachSeries(Accounts, function (account, eachCb) {
                openAccount(account, i, function () {
                    if (accountOpenTurn < totalMembers) {
                        accountOpenTurn++;
                    }
                    i++;
                    return eachCb();
                });
            }, function (err) {
                return seriesCb();
            });
        },
        function (seriesCb) {
            return openAccount(NoLISKAccount, null, seriesCb);
        },
        function (seriesCb) {
            return openAccount(MultisigAccount, null, seriesCb);
        },
        function (seriesCb) {
            var i = 0;
            async.eachSeries(Accounts, function (account, eachCb) {
                sendLISK(account, i, function () {
                    i++;
                    return eachCb();
                });
            }, function (err) {
                return seriesCb();
            });
        },
        function (seriesCb) {
            return sendLISK(MultisigAccount, null, seriesCb);
        }
    ], function (err) {
        node.onNewBlock(function (err) {
            done(err);
        });
    });
});

describe("PUT /multisignatures", function () {

    before(function (done) {
        Keys = makeKeysGroup();
        done();
    });

    it("When owner's public key in keysgroup. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: Accounts[Accounts.length-1].password,
                lifetime: 1,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When account has 0 LISK. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: NoLISKAccount.password,
                lifetime: 1,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When keysgroup is empty. Should fail", function (done) {
        var emptyKeys = [];

        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: requiredSignatures,
                keysgroup: emptyKeys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When no keygroup is given. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: requiredSignatures
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When keysgroup is a string. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: requiredSignatures,
                keysgroup: "invalid"
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When no passphase is given. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                lifetime: 1,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When an invalid passphrase is given. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password + "inv4lid",
                lifetime: 1,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When no lifetime is given. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When lifetime is a string. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: "invalid",
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When lifetime is greater than the maximum allowed. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 99999999,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When lifetime is zero. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 0,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When lifetime is negative. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: -1,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When lifetime is a string. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: "2",
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When no min is given. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When min is invalid. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: "invalid",
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When min is greater than the total members. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: totalMembers + 5,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When min is zero. Should fail", function (done) {
        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: 0,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When min is negative. Should fail", function (done) {
        var minimum = -1 * requiredSignatures;

        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: minimum,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When min is a string. Should fail", function (done) {
        var minimum =  toString(requiredSignatures);

        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: 1,
                min: minimum,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("When data is valid. Should be ok", function (done) {
        var life = parseInt(node.randomNumber(1,25));

        node.api.put("/multisignatures")
            .set("Accept", "application/json")
            .send({
                secret: MultisigAccount.password,
                lifetime: life,
                min: requiredSignatures,
                keysgroup: Keys
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.true;
                node.expect(res.body).to.have.property("transactionId");
                if (res.body.success && res.body.transactionId) {
                    MultiSigTX.txId = res.body.transactionId;
                    MultiSigTX.lifetime = life;
                    MultiSigTX.members = Keys;
                    MultiSigTX.min = requiredSignatures;
                } else {
                    console.log("Transaction failed or transactionId null");
                    node.expect("test").to.equal("FAILED");
                }
                done();
            });
    });
});

describe("GET /multisignatures/pending", function () {

    it("Using invalid public key. Should fail", function (done) {
        var publicKey = 1234;

        node.api.get("/multisignatures/pending?publicKey=" + publicKey)
            .set("Accept", "application/json")
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                node.expect(res.body).to.have.property("error");
                done();
            });
    });

    it("Using no public key. Should be ok", function (done) {
        node.api.get("/multisignatures/pending?publicKey=")
            .set("Accept", "application/json")
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success");
                node.expect(res.body).to.have.property("success").to.be.true;
                node.expect(res.body).to.have.property("transactions").that.is.an("array");
                node.expect(res.body.transactions.length).to.equal(0);
                done();
            });
    });

    it("Using valid public key. Should be ok", function (done) {
        node.onNewBlock(function (err) {
            // console.log(JSON.stringify(MultisigAccount));
            node.api.get("/multisignatures/pending?publicKey=" + MultisigAccount.publicKey)
                .set("Accept", "application/json")
                .expect("Content-Type", /json/)
                .expect(200)
                .end(function (err, res) {
                    // console.log(JSON.stringify(res.body));
                    node.expect(res.body).to.have.property("success").to.be.true;
                    node.expect(res.body).to.have.property("transactions").that.is.an("array");
                    node.expect(res.body.transactions.length).to.be.at.least(1);
                    var flag = 0;
                    for (var i = 0; i < res.body.transactions.length; i++) {
                        // console.log(MultisigAccount.publicKey);
                        if (res.body.transactions[i].transaction.senderPublicKey == MultisigAccount.publicKey) {
                            flag += 1;
                            node.expect(res.body.transactions[i].transaction).to.have.property("type").to.equal(node.TxTypes.MULTI);
                            node.expect(res.body.transactions[i].transaction).to.have.property("amount").to.equal(0);
                            node.expect(res.body.transactions[i].transaction).to.have.property("asset").that.is.an("object");
                            node.expect(res.body.transactions[i].transaction).to.have.property("fee").to.equal(node.Fees.multisignatureRegistrationFee * (Keys.length + 1));
                            node.expect(res.body.transactions[i].transaction).to.have.property("id").to.equal(MultiSigTX.txId);
                            node.expect(res.body.transactions[i].transaction).to.have.property("senderPublicKey").to.equal(MultisigAccount.publicKey);
                            node.expect(res.body.transactions[i]).to.have.property("lifetime").to.equal(MultiSigTX.lifetime);
                            node.expect(res.body.transactions[i]).to.have.property("min").to.equal(MultiSigTX.min);
                        }
                    }
                    node.expect(flag).to.equal(1);
                    node.onNewBlock(function (err) {
                        done();
                    });
                });
        });
    });
});

describe("PUT /api/transactions", function () {

    it("When group transaction is pending. Should be ok", function (done) {
        sendLISKfromMultisigAccount(100000000, node.Gaccount.address, function (err, transactionId) {
            node.onNewBlock(function (err) {
                node.api.get("/transactions/get?id=" + transactionId)
                    .set("Accept", "application/json")
                    .expect("Content-Type", /json/)
                    .expect(200)
                    .end(function (err, res) {
                        // console.log(JSON.stringify(res.body));
                        node.expect(res.body).to.have.property("success").to.be.true;
                        node.expect(res.body).to.have.property("transaction");
                        node.expect(res.body.transaction).to.have.property("id").to.eql(transactionId);
                        done();
                    });
            });
        });
    });
});

describe("POST /multisignatures/sign (group)", function () {

    it("Using random passphrase. Should fail", function (done) {
        var account = node.randomAccount();

        node.api.post("/multisignatures/sign")
            .set("Accept", "application/json")
            .send({
                secret: account.password,
                transactionId: MultiSigTX.txId
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                done();
            });
    });

    it("Using null passphrase. Should fail", function (done) {
        node.api.post("/multisignatures/sign")
            .set("Accept", "application/json")
            .send({
                secret: null,
                transactionId: MultiSigTX.txId
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                done();
            });
    });

    it("Using undefined passphrase. Should fail", function (done) {
        node.api.post("/multisignatures/sign")
            .set("Accept", "application/json")
            .send({
                secret: undefined,
                transactionId: MultiSigTX.txId
            })
            .expect("Content-Type", /json/)
            .expect(200)
            .end(function (err, res) {
                // console.log(JSON.stringify(res.body));
                node.expect(res.body).to.have.property("success").to.be.false;
                done();
            });
    });

    it("Using one less than total signatures. Should not confirm transaction", function (done) {
        var passphrases = Accounts.map(function (account) {
            return account.password;
        })

        confirmTransaction(MultiSigTX.txId, passphrases.slice(0, (passphrases.length - 1)), function () {
            node.onNewBlock(function (err) {
                node.api.get("/transactions/get?id=" + MultiSigTX.txId)
                    .set("Accept", "application/json")
                    .expect("Content-Type", /json/)
                    .expect(200)
                    .end(function (err, res) {
                        // console.log(JSON.stringify(res.body));
                        node.expect(res.body).to.have.property("success").to.be.false;
                        done();
                    });
            });
        });
    });

    it("Using one more signature. Should confirm transaction", function (done) {
        var passphrases = Accounts.map(function (account) {
            return account.password;
        });

        confirmTransaction(MultiSigTX.txId, passphrases.slice(-1), function () {
            node.onNewBlock(function (err) {
                node.api.get("/transactions/get?id=" + MultiSigTX.txId)
                    .set("Accept", "application/json")
                    .expect("Content-Type", /json/)
                    .expect(200)
                    .end(function (err, res) {
                        // console.log(JSON.stringify(res.body));
                        node.expect(res.body).to.have.property("success").to.be.true;
                        node.expect(res.body).to.have.property("transaction");
                        node.expect(res.body.transaction).to.have.property("id").to.eql(MultiSigTX.txId);
                        done();
                    });
            });
        });
    });
});

describe("POST /multisignatures/sign (transaction)", function () {
    before(function (done) {
        sendLISKfromMultisigAccount(100000000, node.Gaccount.address, function (err, transactionId) {
            MultiSigTX.txId = transactionId;
            done();
        });
    });

    it("Using one less than minimum signatures. Should not confirm transaction", function (done) {
        var passphrases = Accounts.map(function (account) {
            return account.password;
        });

        confirmTransaction(MultiSigTX.txId, passphrases.slice(0, (MultiSigTX.min - 1)), function () {
            node.onNewBlock(function (err) {
                node.api.get("/transactions/get?id=" + MultiSigTX.txId)
                    .set("Accept", "application/json")
                    .expect("Content-Type", /json/)
                    .expect(200)
                    .end(function (err, res) {
                        // console.log(JSON.stringify(res.body));
                        node.expect(res.body).to.have.property("success").to.be.false;
                        done();
                    });
            });
        });
    });

    it("Using one more signature. Should confirm transaction", function (done) {
        var passphrases = Accounts.map(function (account) {
            return account.password;
        });

        confirmTransaction(MultiSigTX.txId, passphrases.slice(-1), function () {
            node.onNewBlock(function (err) {
                node.api.get("/transactions/get?id=" + MultiSigTX.txId)
                    .set("Accept", "application/json")
                    .expect("Content-Type", /json/)
                    .expect(200)
                    .end(function (err, res) {
                        // console.log(JSON.stringify(res.body));
                        node.expect(res.body).to.have.property("success").to.be.true;
                        node.expect(res.body).to.have.property("transaction");
                        node.expect(res.body.transaction).to.have.property("id").to.eql(MultiSigTX.txId);
                        done();
                    });
            });
        });
    });
});
