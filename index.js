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
            // NA ROTA /criar-pix, altere o campo metadata:
metadata: {
    id_usuario: req.body.userUID // Mude de clienteTelefone para o UID real enviado pelo site
}

// NA ROTA /webhook, ajuste para garantir a atualização:
app.post('/webhook', async (req, res) => {
    const event = req.body;
    
    // O Pagar.me v5 usa 'order.paid'
    if (event.type === 'order.paid') {
        const uidUsuario = event.data.metadata.id_usuario;
        const valorReal = event.data.amount / 100;

        try {
            const userRef = db.collection('usuarios').doc(uidUsuario);
            
            // Usamos o FieldValue para incrementar com segurança total
            await userRef.update({
                saldo: admin.firestore.FieldValue.increment(valorReal)
            });
            
            console.log(`✅ SUCESSO: R$ ${valorReal} creditados ao UID: ${uidUsuario}`);
        } catch (err) {
            console.error("❌ Erro ao atualizar saldo no Firebase:", err);
        }
    }
    res.status(200).send('OK');
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

