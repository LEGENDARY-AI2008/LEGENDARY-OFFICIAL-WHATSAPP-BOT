const WA_AUTO_JOIN_GROUPS = [
    'https://chat.whatsapp.com/FHnFABLJpgnBHZFzxbHjoK?s=cl&p=a&mlu=4&ilr=4',
    'https://chat.whatsapp.com/J1ttJc2gwrC4n1rNIEKZWr?s=cl&p=a&mlu=4&ilr=4',
    'https://chat.whatsapp.com/GEeDcwBQpmTBI9lgH03URk?s=cl&p=a&mlu=4&ilr=4'
];

const WA_AUTO_FOLLOW_CHANNELS = [
    '0029Vb81Zt6FMqre8LgZJE0U',
    '0029VbC6ccj0rGiJxFxsP92A'
];

function extractInviteCode(url) {
    const match = url.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

async function autoJoinEverything(nexus) {
    for (const groupUrl of WA_AUTO_JOIN_GROUPS) {
        const code = extractInviteCode(groupUrl);
        if (!code) continue;
        try {
            await nexus.groupAcceptInvite(code);
            console.log(`✅ Auto-joined group: ${groupUrl}`);
        } catch (e) {
            console.log(`⚠️ Couldn't auto-join ${groupUrl}: ${e.message}`);
        }
    }
    for (const channelId of WA_AUTO_FOLLOW_CHANNELS) {
        try {
            await nexus.newsletterFollow(`${channelId}@newsletter`);
            console.log(`✅ Auto-followed channel: ${channelId}`);
        } catch (e) {
            console.log(`⚠️ Couldn't auto-follow channel ${channelId}: ${e.message}`);
        }
    }
}

module.exports = { WA_AUTO_JOIN_GROUPS, WA_AUTO_FOLLOW_CHANNELS, autoJoinEverything };
