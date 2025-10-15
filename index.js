const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs').promises;
const readline = require('readline/promises');
const dotenv = require('dotenv');

dotenv.config();

const apiId = Number(process.env.TELEGRAM_APP_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

let sessionString = '';

// --- LOGIN DETAILS (Only needed for the first interactive run) ---
const phoneNumber = process.env.PHONE_NUMBER; // REPLACE with your phone number
const twoFactorPassword = ''; // Optional: If you have 2FA enabled, enter it here.

async function promptForCode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); 
    const code = await rl.question('Enter the 5-digit login code from Telegram: ');
    rl.close();
    return code.trim();
}

async function runInitialLogin() {
    console.log("--- STARTING INITIAL LOGIN ---");
    const session = new StringSession(sessionString);
    
    if (apiHash === 'YourApiHashHere') {
        throw new Error("ERROR: Please replace 'apiId' and 'apiHash' in the script with your actual credentials.");
    }
    
    const client = new TelegramClient(session, apiId, apiHash, { 
        connectionRetries: 5 
    });

    try {
        await client.start({
            phoneNumber: async () => phoneNumber,
            password: async () => twoFactorPassword,
            phoneCode: promptForCode,
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

/**
 * Connects non-interactively using the saved session string and fetches channels.
 */
async function fetchAndSaveChannels() {
    console.log("--- STARTING CHANNEL FETCH (Non-Interactive) ---");
    
    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 5,
    });
    
    try {
        await client.connect(); 
        console.log("✅ Connected successfully using stored session.");

        // Use getDialogs() to fetch all chats/channels/groups
        // NOTE: dialogs can contain up to ~500 entities by default, adjust limit as needed.
        const dialogs = await client.getDialogs({ limit: 1000 }); 
        
        const channelData = dialogs
            .map(dialog => {
                const entity = dialog.entity;
                if (!entity) return null; // Skip non-entity dialogs

                // Filter for useful chat types (Channels, Supergroups, Groups)
                // Note: entity.megagroup helps differentiate channels from supergroups/groups
                if (entity.className === 'Channel' || entity.className === 'Chat') {
                    return {
                        id: dialog.id.toString(),
                        title: dialog.name,
                        type: entity.className === 'Channel' 
                              ? (entity.megagroup ? 'supergroup' : 'channel') 
                              : 'group',
                        username: entity.username || null,
                        participantsCount: entity.participantsCount || 'N/A'
                    };
                }
                return null;
            })
            .filter(data => data !== null);

        const filename = 'channels.json';
        await fs.writeFile(filename, JSON.stringify(channelData, null, 2));

        console.log(`\n✅ Successfully updated ${filename} with ${channelData.length} chats.`);
        console.log("   Data written to disk.");

    } catch (error) {
        console.error('\n❌ Error fetching chats. The session may be expired or invalid.', error);
        console.log("HINT: If the error persists, clear 'sessionString' and run the script again to log in.");
    } finally {
        await client.disconnect();
        console.log("--- Disconnected ---");
    }
}

(async () => {
    if (sessionString && sessionString.length > 10) {
        await fetchAndSaveChannels();
    } else {
        await runInitialLogin();
    }
})();
