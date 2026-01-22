const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// CONFIGURAÇÕES DO PAGAR.ME (Substitua pela sua chave sk_)
const PAGARME_SECRET_KEY = 'sk_91d5411c659a4b0295e81b3e53e591a1';

app.post('/criar-pix', async (req, res) => {
    const { valor, clienteNome, clienteTelefone } = req.body;

    // Converte o valor para centavos (R$ 10.00 -> 1000)
    const amountInCents = Math.round(parseFloat(valor) * 100);

    const data = {
        items: [{
            amount: amountInCents,
            description: "Deposito Voto Bet",
            quantity: 1
        }],
        customer: {
            name: clienteNome,
            type: "individual",
            phones: {
                mobile_phone: {
                    country_code: "55",
                    area_code: clienteTelefone.substring(0, 2),
                    number: clienteTelefone.substring(2)
                }
            }
        },
        payments: [{
            payment_method: "pix",
            pix: {
                expires_in: 3600 // PIX dura 1 hora
            }
        }]
    };

    try {
        const response = await axios.post('https://api.pagar.me/core/v5/orders', data, {
            auth: { username: PAGARME_SECRET_KEY, password: '' }
        });

        const pixData = response.data.charges[0].last_transaction;
        
        res.json({
            qrcode: pixData.qr_code_url,
            copyPaste: pixData.qr_code,
            orderId: response.data.id
        });
    } catch (error) {
        console.error(error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));