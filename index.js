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
        const { valor, clienteNome, clienteTelefone, clienteCPF, userUID } = req.body;
        const amountInCents = Math.round(parseFloat(valor) * 100);

        const cpfLimpo = clienteCPF.replace(/\D/g, "");
        const telLimpo = clienteTelefone.replace(/\D/g, "");

        console.log(`Gerando PIX para: ${clienteNome} | UID: ${userUID} | Valor: R$ ${valor}`);

        const data = {
            items: [{
                amount: amountInCents,
                description: "Depósito Voto Bet",
                quantity: 1,
                code: "deposito_01"
            }],
            customer: {
                name: clienteNome,
                email: "cliente@votobet.com", // Opcional: pode vir do body também
                type: "individual",
                document: cpfLimpo,
                phones: {
                    mobile_phone: {
                        country_code: "55",
                        area_code: telLimpo.substring(0, 2),
                        number: telLimpo.substring(2)
                    }
                }
            },
            payments: [{
                payment_method: "pix",
                pix: {
                    expires_in: 3600
                }
            }],
            metadata: {
                id_usuario: userUID // CRUCIAL: Vincula o pagamento ao UID do Firebase
            }
        };

        const response = await axios.post('https://api.pagar.me/core/v5/orders', data, {
            auth: { username: PAGARME_SECRET_KEY, password: '' }
        });

        const transaction = response.data.checkouts ? response.data.checkouts[0] : response.data.payments[0].pix;

        if (transaction.qr_code_url || response.data.payments[0].pix.qr_code_url) {
            const pixData = response.data.payments[0].pix;
            res.json({ 
                qrcode: pixData.qr_code_url, 
                copyPaste: pixData.qr_code 
            });
        } else {
            res.status(400).json({ error: "Pagar.me não gerou o QR Code" });
        }

    } catch (error) {
        console.error("ERRO NO SERVIDOR:", error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).json({ error: "Erro interno ao processar PIX" });
    }
}); // <--- Chave de fecho da rota /criar-pix corrigida

// 2. ROTA DE WEBHOOK (POSTBACK)
app.post('/webhook', async (req, res) => {
    const event = req.body;
    console.log("Evento recebido do Pagar.me:", event.type);

    // O Pagar.me v5 envia 'order.paid' quando o Pix é confirmado
    if (event.type === 'order.paid') {
        const uidUsuario = event.data.metadata.id_usuario;
        const valorReal = event.data.amount / 100;

        try {
            if (!uidUsuario) {
                console.error("❌ Erro: Webhook recebido sem id_usuario no metadata");
                return res.status(400).send('Metadata ausente');
            }

            const userRef = db.collection('usuarios').doc(uidUsuario);
            
            // Incrementa o saldo diretamente no Firebase (mais seguro)
            await userRef.update({
                saldo: admin.firestore.FieldValue.increment(valorReal)
            });

            console.log(`✅ SALDO ATUALIZADO: R$ ${valorReal} para o UID: ${uidUsuario}`);
            return res.status(200).send('Saldo Creditado');
            
        } catch (err) {
            console.error("❌ Erro ao atualizar Firebase no Webhook:", err);
            return res.status(500).send('Erro interno');
        }
    }

    // Responde 200 para qualquer outro evento para o Pagar.me não ficar reenviando
    res.status(200).send('Evento ignorado');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
