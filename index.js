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
    try {
        const { valor, clienteNome, clienteTelefone } = req.body;
        const amountInCents = Math.round(parseFloat(valor) * 100);

        // Limpa o telefone para garantir que tenha apenas números (Pagar.me exige isso)
        const apenasNumeros = clienteTelefone.replace(/\D/g, "");

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
                document: "10714457000", // CPF de teste válido (O Pagar.me rejeita 00000000000)
                phones: {
                    mobile_phone: {
                        country_code: "55",
                        area_code: apenasNumeros.substring(0, 2) || "11",
                        number: apenasNumeros.substring(2) || "999999999"
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
                id_usuario: clienteTelefone // Mantemos o UID original aqui para o Webhook achar no Firebase
            }
        };

        const response = await axios.post('https://api.pagar.me/core/v5/orders', data, {
            auth: { username: PAGARME_SECRET_KEY, password: '' }
        });

        console.log("RESPOSTA COMPLETA DO PAGARME:", JSON.stringify(response.data));

        // Tenta pegar o QR Code de dois caminhos diferentes (garantia)
        const charge = response.data.charges ? response.data.charges[0] : null;
        const transaction = charge ? charge.last_transaction : null;

        if (transaction && transaction.qr_code_url) {
            res.json({ 
                qrcode: transaction.qr_code_url, 
                copyPaste: transaction.qr_code 
            });
        } else {
            console.error("Pagar.me não gerou transação PIX. Verifique se o PIX está ativo na sua conta.");
            res.status(400).json({ error: "Pagar.me não devolveu o QR Code", detalhes: response.data });
        }
});

// 2. ROTA DE WEBHOOK (Onde o saldo cai automático)
app.post('/webhook', async (req, res) => {
    const event = req.body;

    // Log para você ver no Render quando o pagamento cair
    console.log("Evento recebido do Pagar.me:", event.type);

    if (event.type === 'order.paid') {
        // No Pagar.me V5, o ID do usuário que guardamos no metadata fica aqui:
        const telefoneUsuario = event.data.metadata.id_usuario;
        
        // O valor vem em centavos (ex: 500 = R$ 5,00)
        const valorReal = event.data.amount / 100;

        try {
            const userRef = db.collection('usuarios').doc(telefoneUsuario);
            const userDoc = await userRef.get();

            if (userDoc.exists) {
                const saldoAtual = userDoc.data().saldo || 0;
                await userRef.update({
                    saldo: saldoAtual + valorReal
                });
                console.log(`SUCESSO: R$ ${valorReal} adicionados ao usuário ${telefoneUsuario}`);
            }
        } catch (err) {
            console.error("Erro ao atualizar saldo:", err);
        }
    }
    // O Pagar.me precisa que você responda "200 OK" para ele não ficar tentando reenviar
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando!`));



