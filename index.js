const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// 1. CONFIGURAÇÃO DO FIREBASE
const serviceAccount = require("./firebase-adminsdk.json"); 

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

const PAGARME_SECRET_KEY = 'sk_91d5411c659a4b0295e81b3e53e591a1';

// ROTA PARA CRIAR O PIX
app.post('/criar-pix', async (req, res) => {
    try {
        const { valor, clienteNome, clienteTelefone, clienteCPF } = req.body;
        const amountInCents = Math.round(parseFloat(valor) * 100);

        // Limpeza de dados para o Pagar.me (Somente números)
        const cpfLimpo = clienteCPF.replace(/\D/g, "");
        const telLimpo = clienteTelefone.replace(/\D/g, "");

        console.log(`Gerando PIX para: ${clienteNome} | Valor: R$ ${valor}`);

        const data = {
            items: [{
                amount: amountInCents,
                description: "Deposito Voto Bet",
                quantity: 1
            }],
            customer: {
                name: clienteNome || "Cliente VotoBet",
                email: "cliente@voto.bet",
                type: "individual",
                document: cpfLimpo, 
                phones: {
                    mobile_phone: {
                        country_code: "55",
                        area_code: telLimpo.substring(0, 2) || "11",
                        number: telLimpo.substring(2) || "999999999"
                    }
                }
            },
            payments: [{
                payment_method: "pix",
                pix: { expires_in: 3600 }
            }],
            metadata: {
                id_usuario: clienteTelefone // Usado pelo Webhook para dar o saldo
            }
        };

        const response = await axios.post('https://api.pagar.me/core/v5/orders', data, {
            auth: { username: PAGARME_SECRET_KEY, password: '' }
        });

        const charge = response.data.charges ? response.data.charges[0] : null;
        const transaction = charge ? charge.last_transaction : null;

        if (transaction && transaction.qr_code_url) {
            res.json({ 
                qrcode: transaction.qr_code_url, 
                copyPaste: transaction.qr_code 
            });
        } else {
            console.error("Erro Pagar.me:", JSON.stringify(response.data));
            res.status(400).json({ error: "Pagar.me não gerou o QR Code" });
        }

    } catch (error) {
        console.error("ERRO NO SERVIDOR:", error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).json({ error: "Erro interno ao processar PIX" });
    }
});

// 2. ROTA DE WEBHOOK
app.post('/webhook', async (req, res) => {
    const event = req.body;
    if (event.type === 'order.paid') {
        const telefoneUsuario = event.data.metadata.id_usuario;
        const valorReal = event.data.amount / 100;
        try {
            const userRef = db.collection('usuarios').doc(telefoneUsuario);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const saldoAtual = userDoc.data().saldo || 0;
                await userRef.update({ saldo: saldoAtual + valorReal });
                console.log(`SUCESSO: R$ ${valorReal} para ${telefoneUsuario}`);
            }
        } catch (err) {
            console.error("Erro Webhook:", err);
        }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor ON na porta ${PORT}`);
});
