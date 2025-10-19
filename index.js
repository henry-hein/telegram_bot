const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fs = require('fs').promises;
const readline = require('readline/promises');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config();

const apiId = Number(process.env.TELEGRAM_APP_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION_ID || '';
const phoneNumber = process.env.PHONE_NUMBER;
const password_2FA = process.env.TELEGRAM_2FA_PASSWORD;
const PORT = process.env.PORT || 3000;
const ALLOWED_USERS_FILEPATH = 'allowedUsers.json';

async function getLoginCredentials() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await rl.question('Enter the 5-digit login code from Telegram: ');
    let code_2FA = '';
    if (!password_2FA) {
        code_2FA = await rl.question('Enter Telegram 2FA password or press enter if no 2FA: ');
    }
    rl.close();
    return { code: code.trim(), code_2FA: code_2FA.trim() };
}

async function isUserAllowed(userId) {
    try {
        const fileContent = await fs.readFile(ALLOWED_USERS_FILEPATH, 'utf8');
        const allowedUsers = JSON.parse(fileContent);

        const numericUserId = Number(userId);

        if (Array.isArray(allowedUsers)) {
            return allowedUsers.some(user => user.userId === numericUserId);
        }
        return false;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`[Permission] Error: Access file (${ALLOWED_USERS_FILEPATH}) not found.`);
        } else if (error instanceof SyntaxError) {
            console.error(`[Permission] Error: Invalid JSON format in ${ALLOWED_USERS_FILEPATH}.`);
        } else {
            console.error('[Permission] Unexpected error during permission check:', error.message);
        }
        return false;
    }
}

async function handleCommands(event, client) {
    const message = event.message;
    
    if (!message.message || !message.message.startsWith('/')) return;

    const parts = message.message.slice(1).split(' ');
    const command = parts[0].toLowerCase();

    if (!message.peerId) return;
    
    const senderId = event.message.senderId.valueOf(); 
    const numericSenderId = Number(senderId);

    let responseText = `Command not recognized: /${command}`;
    
    console.log(`[Command Handler] Received command: /${command} from user ${numericSenderId}`);

    if (command === 'start') {
        responseText = 'Hello! This is Wert Official Telegram bot.';
    } else if (command === 'help') {
        responseText = responseText = `*Available Commands*

        /help - See available commands
        /fetchchannels - Restricted to wert employees only
        /start - Start the bot`;
    } else if (command === 'fetchchannels') {
        const isAllowed = await isUserAllowed(numericSenderId);
        
        if (isAllowed) {
            responseText = '✅ Permission granted. Processing request...';
            fetchChannelData(client, message.peerId); 
        } else {
            responseText = `❌ Access Denied. Your ID (${numericSenderId}) is not in the allowed list.`;
        }
    }
    
    try {
        await client.sendMessage(message.peerId, { message: responseText });
    } catch (e) {
        console.error(`Error sending response to chat ${message.peerId}:`, e.message);
    }
}

async function runPersistentService() {
    console.log("--- STARTING PERSISTENT TELEGRAM SERVICE ---");

    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 5,
    });

    try {
        await client.connect();
        console.log("✅ Connected successfully using stored session.");

        client.addEventHandler(
            (event) => handleCommands(event, client),
            new NewMessage({})
        );
        console.log("✅ Command handler initialized. Client is running and listening for commands.");

        await new Promise(() => { });

    } catch (error) {
        console.error('\n❌ Fatal Error in Persistent Service. The session may be expired or invalid.', error);
        console.log("HINT: If the error persists, clear 'sessionString' and run the script again to log in.");
        await client.disconnect();
    }
}

async function runInitialLogin() {
    console.log("--- STARTING INITIAL LOGIN ---");
    const session = new StringSession(sessionString);

    if (!apiHash) {
        throw new Error("ERROR: Please replace 'apiId' and 'apiHash' in the environment variables with your actual credentials.");
    }

    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5
    });

    try {
        const credentials = await getLoginCredentials();

        await client.start({
            phoneNumber: phoneNumber,
            phoneCode: async () => credentials.code,
            password: password_2FA ? password_2FA : async () => credentials.code_2FA,
            onError: (err) => console.error(err),
        });

        const newSessionString = client.session.save();
        console.log("\n=======================================================");
        console.log("✅ LOGIN SUCCESSFUL. NEW SESSION STRING GENERATED:");
        console.log(newSessionString);
        console.log("=======================================================");
        console.log("ACTION REQUIRED: Copy this string and paste it into the 'sessionString' variable for non-interactive use.");

        return newSessionString;
    } catch (error) {
        console.error('ERROR during login process:', error);
        throw error;
    } finally {
        await client.disconnect();
    }
}

async function fetchChannelData(client, chatId) {
    await client.sendMessage(chatId, { message: "Retrieving channels. This may take a moment..." });
    const filename = 'channels.json';

    try {
        const dialogs = await client.getDialogs({ limit: 1000 });

        const chatData = dialogs
            .map(dialog => {
                const entity = dialog.entity;

                if (!entity) return null;

                if (entity.className === 'Chat' || (entity.className === 'Channel' && entity.megagroup)) {
                    
                    let type;
                    if (entity.className === 'Chat') {
                        type = 'group';
                    } else {
                        type = 'supergroup';
                    }

                    return {
                        id: dialog.id.toString(),
                        title: dialog.name,
                        type: type,
                        username: entity.username || null,
                        participantsCount: entity.participantsCount || 'N/A'
                    };
                }
                return null;
            })
            .filter(data => data !== null);

        await fs.writeFile(filename, JSON.stringify(chatData, null, 2));

        const completionMessage = `🎉 Data Fetch Complete! \nSuccessfully retrieved and saved all chats to the file \`${filename}\`.`;
        await client.sendMessage(chatId, { message: completionMessage });

        console.log(`\n✅ Chat Data Fetch Complete. Updated ${filename} with ${chatData.length} entries.`);

    } catch (error) {
        const errorMessage = `❌ ERROR during chat data fetching: ${error.message}`;
        await client.sendMessage(chatId, { message: errorMessage });
        console.error('\n❌ Error fetching chat data:', error);
    }
}

function startWebserver() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('PONG');
    });

    server.listen(PORT, () => {
        console.log(`\n✅ HTTP Server listening on port ${PORT}.`);
    });

    server.on('error', (e) => {
        console.error('HTTP Server Error:', e.message);
    });
}

(async () => {
    if (sessionString && sessionString.length > 10) {
        startWebserver();
        await runPersistentService();
    } else {
        await runInitialLogin();
    }
})();
