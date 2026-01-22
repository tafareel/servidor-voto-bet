const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors());

// 1. CONFIGURAÇÃO DO FIREBASE (Admin SDK)
// Você baixa esse arquivo no Console do Firebase > Configurações do Projeto > Contas de Serviço
const serviceAccount = require("./firebase-adminsdk.json"); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const PAGARME_SECRET_KEY = 'sk_91d5411c659a4b0295e81b3e53e591a1';

// ROTA PARA CRIAR O PIX
app.post('/criar-pix', async (req, res) => {
    const { valor, clienteNome, clienteTelefone } = req.body;
    const amountInCents = Math.round(parseFloat(valor) * 100);

    const data = {
        items: [{ amount: amountInCents, description: "Deposito Voto Bet", quantity: 1 }],
        customer: {
            name: clienteNome,
            email: "cliente@voto.bet", // Email fictício necessário
            type: "individual",
            document: "00000000000", // O Pagar.me V5 exige um documento (pode ser o do cliente se você coletar)
            phones: { mobile_phone: { country_code: "55", area_code: clienteTelefone.substring(0, 2), number: clienteTelefone.substring(2) } }
        },
        payments: [{ payment_method: "pix", pix: { expires_in: 3600 } }],
        metadata: { id_usuario: clienteTelefone } // IMPORTANTE: Para saber quem recebeu o dinheiro depois
    };

    try {
        const response = await axios.post('https://api.pagar.me/core/v5/orders', data, {
            auth: { username: PAGARME_SECRET_KEY, password: '' }
        });
        const pixData = response.data.charges[0].last_transaction;
        res.json({ qrcode: pixData.qr_code_url, copyPaste: pixData.qr_code });
    } catch (error) {
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

// 2. ROTA DE WEBHOOK (Onde o saldo cai automático)
app.post('/webhook', async (req, res) => {
    const event = req.body;

    // Verifica se o pagamento foi confirmado
    if (event.type === 'order.paid') {
        const telefoneUsuario = event.data.metadata.id_usuario;
        const valorPagoCentavos = event.data.amount;
        const valorReal = valorPagoCentavos / 100;

        try {
            const userRef = db.collection('usuarios').doc(telefoneUsuario);
            const userDoc = await userRef.get();

            if (userDoc.exists) {
                const saldoAtual = userDoc.data().saldo || 0;
                await userRef.update({
                    saldo: saldoAtual + valorReal
                });
                console.log(`Saldo atualizado para ${telefoneUsuario}: + R$ ${valorReal}`);
            }
        } catch (err) {
            console.error("Erro ao atualizar saldo no Firebase:", err);
        }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando!`));
