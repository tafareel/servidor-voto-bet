const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// 1. CONFIGURAÇÃO DO FIREBASE
// Certifique-se de que o arquivo firebase-adminsdk.json está na mesma pasta no GitHub
try {
    const serviceAccount = require("./firebase-adminsdk.json"); 
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    console.error("ERRO CRÍTICO: Arquivo firebase-adminsdk.json não encontrado!");
}

const db = admin.firestore();
const PAGARME_SECRET_KEY = 'sk_91d5411c659a4b0295e81b3e53e591a1';

// ROTA PARA CRIAR O PIX
app.post('/criar-pix', async (req, res) => {
    try {
        const { valor, clienteNome, clienteTelefone, clienteCPF, userUID } = req.body;
        
        if (!userUID) return res.status(400).json({ error: "userUID é obrigatório" });

        const amountInCents = Math.round(parseFloat(valor) * 100);
        const cpfLimpo = clienteCPF.replace(/\D/g, "");
        const telLimpo = clienteTelefone.replace(/\D/g, "");

        const data = {
            items: [{
                amount: amountInCents,
                description: "Deposito Voto Bet",
                quantity: 1,
                code: "deposito_pix"
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
                id_usuario: userUID // Agora usamos o UID real para o saldo
            }
        };

        const response = await axios.post('https://api.pagar.me/core/v5/orders', data, {
            auth: { username: PAGARME_SECRET_KEY, password: '' }
        });

        // Ajuste na leitura da resposta v5
        const pixData = response.data.payments[0].pix;

        if (pixData && pixData.qr_code) {
            res.json({ 
                qrcode: pixData.qr_code_url, 
                copyPaste: pixData.qr_code 
            });
        } else {
            throw new Error("Pagar.me não retornou dados do PIX");
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
        const uidUsuario = event.data.metadata.id_usuario;
        const valorReal = event.data.amount / 100;
        
        try {
            const userRef = db.collection('usuarios').doc(uidUsuario);
            await userRef.update({
                saldo: admin.firestore.FieldValue.increment(valorReal)
            });
            console.log(`✅ SALDO CREDITADO: R$ ${valorReal} para UID: ${uidUsuario}`);
        } catch (err) {
            console.error("Erro ao atualizar saldo no Webhook:", err);
        }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
