require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

// ID du salon où envoyer les transcriptions (optionnel, à définir dans .env : TICKET_LOG_CHANNEL_ID=...)
const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID;

// ==========================================
// 0. STOCKAGE JSON SIMPLE (pour les nouvelles commandes)
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJSON(file, fallback) {
  const p = path.join(DATA_DIR, file);
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error(`❌ Erreur de lecture ${file} :`, e);
    return fallback;
  }
}

function saveJSON(file, data) {
  const p = path.join(DATA_DIR, file);
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`❌ Erreur d'écriture ${file} :`, e);
  }
}

// configs[guildId] = { welcomeChannelId, welcomeMessage, goodbyeChannelId, goodbyeMessage,
//   autoroleId, modlogChannelId, prefix, language, maintenance }
const configs = loadJSON('config.json', {});
function getGuildConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = {};
  return configs[guildId];
}
function saveConfigs() { saveJSON('config.json', configs); }

// warnings[guildId][userId] = [{ id, reason, moderatorId, date }]
const warningsDB = loadJSON('warnings.json', {});
function getWarnings(guildId, userId) {
  if (!warningsDB[guildId]) warningsDB[guildId] = {};
  if (!warningsDB[guildId][userId]) warningsDB[guildId][userId] = [];
  return warningsDB[guildId][userId];
}
function saveWarnings() { saveJSON('warnings.json', warningsDB); }

// tickets[channelId] = { claimedBy, closed }
const ticketsDB = loadJSON('tickets.json', {});
function saveTickets() { saveJSON('tickets.json', ticketsDB); }

async function sendModLog(guild, embed) {
  const cfg = getGuildConfig(guild.id);
  const channelId = cfg.modlogChannelId || TICKET_LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
}

// Types de tickets disponibles pour le menu de sélection
const TICKET_TYPES = {
  report_player: {
    label: 'Signalement de joueur',
    emoji: '👤',
    description: 'Signaler un joueur ou demander une sanction.',
    prefix: 'signalement-joueur',
    welcome: 'Merci d\'avoir ouvert un ticket de **signalement de joueur**.\nMerci de préciser :\n- Le pseudo du joueur concerné\n- La date et l\'heure approximative des faits\n- Une description détaillée de la situation\n- Toute preuve disponible (captures d\'écran, vidéos, etc.)'
  },
  report_admin: {
    label: 'Signalement d\'admin',
    emoji: '🛡️',
    description: 'Signaler un abus ou un comportement inapproprié d\'un administrateur.',
    prefix: 'signalement-admin',
    welcome: 'Merci d\'avoir ouvert un ticket de **signalement d\'admin**.\nMerci de préciser :\n- Le pseudo de l\'administrateur concerné\n- La date et l\'heure approximative des faits\n- Une description détaillée de la situation\n- Toute preuve disponible (captures d\'écran, vidéos, etc.)'
  },
  report_chef: {
    label: 'Signalement de chef',
    emoji: '⭐',
    description: 'Signaler un abus ou un problème concernant un chef de faction.',
    prefix: 'signalement-chef',
    welcome: 'Merci d\'avoir ouvert un ticket de **signalement de chef**.\nMerci de préciser :\n- Le pseudo et la faction du chef concerné\n- La date et l\'heure approximative des faits\n- Une description détaillée de la situation\n- Toute preuve disponible (captures d\'écran, vidéos, etc.)'
  }
};

// Vérification de sécurité des variables d'environnement
if (!process.env.TOKEN || !process.env.CLIENT_ID) {
  console.error("❌ ERREUR : Le TOKEN ou le CLIENT_ID est manquant dans le fichier .env !");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ]
});

// ==========================================
// 1. DÉFINITION DE TOUTES LES COMMANDES SLASH
// ==========================================
const commands = [
  // Modération
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à bannir').setRequired(true))
    .addStringOption(opt => opt.setName('raison').setDescription('Raison du ban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('expulser')
    .setDescription('Expulser un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à expulser').setRequired(true))
    .addStringOption(opt => opt.setName('raison').setDescription('Raison de l\'expulsion'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Infliger une sanction à un utilisateur.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à sanctionner').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Réduire au silence un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à rendre muet').setRequired(true))
    .addIntegerOption(opt => opt.setName('duree').setDescription('Durée en minutes').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('demute')
    .setDescription('Retirer la réduction au silence d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('deban')
    .setDescription('Révoquer le bannissement d\'un utilisateur.')
    .addStringOption(opt => opt.setName('user_id').setDescription('ID de l\'utilisateur à débannir').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('avertir')
    .setDescription('Avertir un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à avertir').setRequired(true))
    .addStringOption(opt => opt.setName('raison').setDescription('Raison de l\'avertissement').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // Infractions
  new SlashCommandBuilder()
    .setName('infractions')
    .setDescription('Gestion des infractions')
    .addSubcommand(sub =>
      sub.setName('ajouter')
         .setDescription('Ajouter une infraction à un membre.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
         .addStringOption(opt => opt.setName('raison').setDescription('Raison').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('lister')
         .setDescription('Afficher les infractions.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('retirer')
         .setDescription('Retirer des infractions à un membre.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
         .addIntegerOption(opt => opt.setName('id').setDescription('ID de l\'infraction').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // Sanctions
  new SlashCommandBuilder()
    .setName('sanctions')
    .setDescription('Gestion de l\'historique des sanctions')
    .addSubcommand(sub =>
      sub.setName('lister')
         .setDescription('Afficher l\'historique des sanctions.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('retirer')
         .setDescription('Retirer l\'historique d\'une sanction d\'un utilisateur.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // Membres & Utilitaires
  new SlashCommandBuilder()
    .setName('normaliser')
    .setDescription('Retirer tous les caractères spéciaux d\'un pseudo.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Ajouter une note à un utilisateur.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addStringOption(opt => opt.setName('contenu').setDescription('Contenu de la note').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('signaler')
    .setDescription('Soumettre un signalement')
    .addSubcommand(sub =>
      sub.setName('message')
         .setDescription('Soumettre une plainte vis-à-vis d\'un message.')
         .addStringOption(opt => opt.setName('message_id').setDescription('ID du message').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('utilisateur')
         .setDescription('Soumettre une plainte vis-à-vis d\'un utilisateur.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre visé').setRequired(true))
    ),

  // Rôles
  new SlashCommandBuilder()
    .setName('secure-roles')
    .setDescription('Gérer votre authentification A2F et vos rôles sécurisés.'),

  new SlashCommandBuilder()
    .setName('roles-permanents')
    .setDescription('Gérer les rôles permanents')
    .addSubcommand(sub =>
      sub.setName('ajouter')
         .setDescription('Ajouter un rôle permanent à un membre.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
         .addRoleOption(opt => opt.setName('role').setDescription('Rôle à attribuer').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('lister')
         .setDescription('Lister tous les rôles permanents d\'un membre.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('retirer')
         .setDescription('Retirer un rôle permanent d\'un ou plusieurs membres.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
         .addRoleOption(opt => opt.setName('role').setDescription('Rôle à retirer').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('réinitialiser')
         .setDescription('Retirer tous les rôles permanents d\'un ou plusieurs membres.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('role-temporaire')
    .setDescription('Gérer les rôles temporaires')
    .addSubcommand(sub =>
      sub.setName('ajouter')
         .setDescription('Ajouter un rôle temporaire à un membre.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
         .addRoleOption(opt => opt.setName('role').setDescription('Rôle à attribuer').setRequired(true))
         .addIntegerOption(opt => opt.setName('duree').setDescription('Durée en minutes').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('lister')
         .setDescription('Voir les rôles temporaires d’un membre ou les membres ayant ce rôle.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé'))
    )
    .addSubcommand(sub =>
      sub.setName('retirer')
         .setDescription('Retirer un rôle temporaire à un membre.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
         .addRoleOption(opt => opt.setName('role').setDescription('Rôle à retirer').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('réinitialiser')
         .setDescription('Réinitialiser les rôles temporaires d\'un membre.')
         .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  // Ticket
  new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('Affiche le panneau de support/ticket')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ==========================================
  // NOUVELLES COMMANDES
  // ==========================================

  // --- Modération ---
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannir un utilisateur (par ID).')
    .addStringOption(opt => opt.setName('user_id').setDescription('ID de l\'utilisateur').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulser un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à expulser').setRequired(true))
    .addStringOption(opt => opt.setName('raison').setDescription('Raison'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Mettre un membre en timeout.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addIntegerOption(opt => opt.setName('duree').setDescription('Durée en minutes').setRequired(true))
    .addStringOption(opt => opt.setName('raison').setDescription('Raison'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Retirer le timeout d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Avertir un membre (enregistré).')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addStringOption(opt => opt.setName('raison').setDescription('Raison').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Voir les avertissements d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprimer plusieurs messages d\'un coup.')
    .addIntegerOption(opt => opt.setName('nombre').setDescription('Nombre de messages (1-100)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Définir le mode lent du salon.')
    .addIntegerOption(opt => opt.setName('secondes').setDescription('Délai en secondes (0 pour désactiver)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouiller le salon (empêcher @everyone d\'écrire).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Déverrouiller le salon.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Changer le pseudo d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addStringOption(opt => opt.setName('pseudo').setDescription('Nouveau pseudo').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Ajouter ou retirer un rôle à un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addRoleOption(opt => opt.setName('role').setDescription('Rôle').setRequired(true))
    .addStringOption(opt => opt.setName('action').setDescription('Ajouter ou retirer').setRequired(true)
      .addChoices({ name: 'Ajouter', value: 'add' }, { name: 'Retirer', value: 'remove' }))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('voicemute')
    .setDescription('Rendre muet un membre en vocal.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),

  new SlashCommandBuilder()
    .setName('voiceunmute')
    .setDescription('Retirer la sourdine vocale d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),

  // --- Informations / utilitaires ---
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Afficher les informations d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé')),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Afficher l\'avatar d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé')),

  new SlashCommandBuilder()
    .setName('banner')
    .setDescription('Afficher la bannière d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé')),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Afficher les informations du serveur.'),

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Lister tous les rôles du serveur.'),

  new SlashCommandBuilder()
    .setName('membercount')
    .setDescription('Afficher le nombre de membres du serveur.'),

  new SlashCommandBuilder()
    .setName('joined')
    .setDescription('Afficher la date d\'arrivée d\'un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé')),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Afficher la latence du bot.'),

  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Afficher les informations du bot.'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Afficher les statistiques du bot.'),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Obtenir le lien d\'invitation du bot.'),

  new SlashCommandBuilder()
    .setName('support')
    .setDescription('Obtenir le lien du serveur de support.'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Afficher la liste des commandes disponibles.'),

  // --- Tickets ---
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ouvrir un ticket de support.'),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Fermer le ticket en cours (dans un salon de ticket).'),

  new SlashCommandBuilder()
    .setName('reopen')
    .setDescription('Rouvrir un ticket fermé (dans un salon de ticket archivé).'),

  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Ajouter un membre au ticket en cours.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à ajouter').setRequired(true)),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Retirer un membre du ticket en cours.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre à retirer').setRequired(true)),

  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Renommer le ticket en cours.')
    .addStringOption(opt => opt.setName('nom').setDescription('Nouveau nom').setRequired(true)),

  new SlashCommandBuilder()
    .setName('claim')
    .setDescription('S\'attribuer le ticket en cours.'),

  new SlashCommandBuilder()
    .setName('unclaim')
    .setDescription('Retirer son attribution du ticket en cours.'),

  new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('Générer la transcription du ticket sans le fermer.'),

  // --- Communication ---
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Envoyer une annonce dans un salon.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Contenu de l\'annonce').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Envoyer un embed personnalisé dans un salon.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(opt => opt.setName('titre').setDescription('Titre de l\'embed').setRequired(true))
    .addStringOption(opt => opt.setName('description').setDescription('Description de l\'embed').setRequired(true))
    .addStringOption(opt => opt.setName('couleur').setDescription('Couleur hex (ex: #5865F2)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Faire répéter un message au bot dans un salon.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Message à envoyer').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Envoyer un message privé à un membre.')
    .addUserOption(opt => opt.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Message à envoyer').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Activer/désactiver le mode maintenance (commandes réservées aux admins).')
    .addBooleanOption(opt => opt.setName('etat').setDescription('Activer ?').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // --- Configuration ---
  new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('Configurer le message de bienvenue.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon de bienvenue').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Message (utilisez {membre} et {serveur})').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setgoodbye')
    .setDescription('Configurer le message d\'au revoir.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon d\'au revoir').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Message (utilisez {membre} et {serveur})').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Configurer le salon de logs général.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon de logs').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setmodlog')
    .setDescription('Configurer le salon de logs de modération.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon de logs modération').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setautorole')
    .setDescription('Configurer le rôle attribué automatiquement aux nouveaux membres.')
    .addRoleOption(opt => opt.setName('role').setDescription('Rôle automatique').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setticket')
    .setDescription('Configurer le salon de logs des tickets.')
    .addChannelOption(opt => opt.setName('salon').setDescription('Salon de logs tickets').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setprefix')
    .setDescription('Définir un préfixe cosmétique (n\'affecte pas les commandes slash).')
    .addStringOption(opt => opt.setName('prefixe').setDescription('Nouveau préfixe').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setlanguage')
    .setDescription('Définir la langue préférée du serveur.')
    .addStringOption(opt => opt.setName('langue').setDescription('Langue').setRequired(true)
      .addChoices({ name: 'Français', value: 'fr' }, { name: 'English', value: 'en' }))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Afficher le panneau de support/ticket (alias de setup-ticket).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Afficher la configuration actuelle du serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

].map(cmd => cmd.toJSON());

// ==========================================
// 1bis. GÉNÉRATION DE TRANSCRIPTION
// ==========================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchAllMessages(channel) {
  let messages = [];
  let lastId;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    messages = messages.concat(Array.from(batch.values()));
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
  return messages.reverse(); // ordre chronologique
}

async function generateTranscript(channel) {
  const messages = await fetchAllMessages(channel);

  const rows = messages.map(msg => {
    const time = new Date(msg.createdTimestamp).toLocaleString('fr-FR');
    const author = escapeHtml(msg.author.tag);
    const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 64 });
    let content = escapeHtml(msg.content || '').replace(/\n/g, '<br>');

    if (msg.embeds.length > 0) {
      content += msg.embeds.map(e => {
        const title = e.title ? `<strong>${escapeHtml(e.title)}</strong><br>` : '';
        const desc = e.description ? escapeHtml(e.description).replace(/\n/g, '<br>') : '';
        return `<div class="embed">${title}${desc}</div>`;
      }).join('');
    }

    if (msg.attachments.size > 0) {
      content += Array.from(msg.attachments.values())
        .map(a => `<div class="attachment">📎 <a href="${a.url}" target="_blank">${escapeHtml(a.name)}</a></div>`)
        .join('');
    }

    return `
      <div class="message">
        <img class="avatar" src="${avatar}" alt="avatar">
        <div class="body">
          <div class="meta"><span class="author">${author}</span> <span class="time">${time}</span></div>
          <div class="content">${content || '<em>(message vide)</em>'}</div>
        </div>
      </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Transcription - ${escapeHtml(channel.name)}</title>
<style>
  body { background:#313338; color:#dbdee1; font-family: 'Segoe UI', Arial, sans-serif; margin:0; padding:20px; }
  h1 { color:#fff; }
  .message { display:flex; gap:12px; padding:8px 0; border-bottom:1px solid #3f4147; }
  .avatar { width:40px; height:40px; border-radius:50%; }
  .meta { font-size:0.85em; margin-bottom:2px; }
  .author { color:#fff; font-weight:600; }
  .time { color:#949ba4; margin-left:8px; }
  .content { white-space:pre-wrap; word-wrap:break-word; }
  .embed { border-left:4px solid #5865F2; background:#2b2d31; padding:8px 12px; margin-top:6px; border-radius:4px; }
  .attachment { margin-top:6px; }
  a { color:#00a8fc; }
</style>
</head>
<body>
  <h1>🎫 Transcription — #${escapeHtml(channel.name)}</h1>
  <p>Généré le ${new Date().toLocaleString('fr-FR')} — ${messages.length} message(s)</p>
  ${rows}
</body>
</html>`;

  return new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `transcript-${channel.name}.html` });
}

// Fermeture d'un ticket : génère la transcription (inchangé), l'envoie en logs + en DM,
// puis ARCHIVE le salon (verrouillé, renommé) au lieu de le supprimer, pour permettre /reopen.
async function closeTicketChannel(channel, closer) {
  const topic = channel.topic || '';
  const openerMatch = topic.match(/ID:(\d+)/);
  const openerId = openerMatch ? openerMatch[1] : null;
  const guild = channel.guild;
  const cfg = getGuildConfig(guild.id);
  const logChannelId = cfg.ticketLogChannelId || TICKET_LOG_CHANNEL_ID;

  try {
    const attachment = await generateTranscript(channel);
    const logEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket fermé — #${channel.name}`)
      .setDescription(`Fermé par ${closer} le ${new Date().toLocaleString('fr-FR')}`)
      .setColor(0xED4245);

    if (logChannelId) {
      const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
      if (logChannel) await logChannel.send({ embeds: [logEmbed], files: [attachment] }).catch(() => {});
    }

    if (openerId) {
      const opener = await client.users.fetch(openerId).catch(() => null);
      if (opener) {
        await opener.send({
          content: `📄 Voici la transcription de ton ticket **#${channel.name}**.`,
          files: [attachment]
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Erreur lors de la génération de la transcription :', err);
  }

  if (!ticketsDB[channel.id]) ticketsDB[channel.id] = {};
  ticketsDB[channel.id].closed = true;
  saveTickets();

  await channel.permissionOverwrites.edit(guild.id, { ViewChannel: false }).catch(() => {});
  if (openerId) await channel.permissionOverwrites.edit(openerId, { ViewChannel: false }).catch(() => {});
  if (!channel.name.startsWith('ferme-')) {
    await channel.setName(`ferme-${channel.name}`.slice(0, 100)).catch(() => {});
  }
}

// ==========================================
// 2. ENREGISTREMENT ET CONNEXION
// ==========================================
console.log("⏳ Démarrage du bot...");

// Enregistrement des commandes (appelé une seule fois, que l'event soit 'clientReady' ou 'ready')
let commandsRegistered = false;
async function registerCommands() {
  if (commandsRegistered) return;
  commandsRegistered = true;

  console.log(`✅ Connecté en tant que ${client.user.tag} !`);

  if (!process.env.CLIENT_ID) {
    console.error('❌ CLIENT_ID est vide dans ton .env : impossible d\'enregistrer les commandes.');
    return;
  }
  if (process.env.CLIENT_ID !== client.user.id) {
    console.error(`❌ CLIENT_ID (${process.env.CLIENT_ID}) ne correspond pas à l'ID du bot connecté (${client.user.id}). Corrige-le dans le .env.`);
    return;
  }

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log(`🔄 Chargement de ${commands.length} commandes auprès de Discord...`);
    console.log('   /setup-staff présent :', commands.some(c => c.name === 'setup-staff'));
    const res = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`🎉 ${res.length} COMMANDES ENREGISTRÉES ET PRÊTES !`);
  } catch (error) {
    console.error('❌ Erreur lors de l\'enregistrement des commandes :', error.message);
    if (error.rawError) console.error(JSON.stringify(error.rawError, null, 2));
  }
}
client.once('clientReady', registerCommands);
client.once('ready', registerCommands);

// ==========================================
// 3. TRAITEMENT DES COMMANDES
// ==========================================
client.on('interactionCreate', async interaction => {
  // 0. Panel de candidature staff (/setup-staff, boutons, formulaire)
  if (await staffHandle(interaction)) return;

  
  // A. Commandes Slash
  if (interaction.isChatInputCommand()) {
    const { commandName, options } = interaction;

    // Mode maintenance : seuls les administrateurs peuvent utiliser les commandes
    const guildCfgCheck = interaction.guild ? getGuildConfig(interaction.guild.id) : {};
    if (guildCfgCheck.maintenance && commandName !== 'maintenance' &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '🛠️ Le bot est actuellement en mode maintenance. Réessaie plus tard.', ephemeral: true });
    }

    try {
      if (commandName === 'ban') {
        const target = options.getMember('membre');
        const reason = options.getString('raison') || 'Aucune raison';
        if (!target.bannable) return interaction.reply({ content: '❌ Je ne peux pas bannir ce membre.', ephemeral: true });
        await target.ban({ reason });
        return interaction.reply({ content: `🔨 **${target.user.tag}** a été banni.` });
      }

      if (commandName === 'expulser') {
        const target = options.getMember('membre');
        const reason = options.getString('raison') || 'Aucune raison';
        if (!target.kickable) return interaction.reply({ content: '❌ Je ne peux pas expulser ce membre.', ephemeral: true });
        await target.kick(reason);
        return interaction.reply({ content: `✅ **${target.user.tag}** a été expulsé.` });
      }

      if (commandName === 'deban') {
        const userId = options.getString('user_id');
        await interaction.guild.members.unban(userId);
        return interaction.reply({ content: `✅ Utilisateur (${userId}) débanni avec succès.` });
      }

      if (commandName === 'mute') {
        const target = options.getMember('membre');
        const duration = options.getInteger('duree');
        await target.timeout(duration * 60 * 1000);
        return interaction.reply({ content: `⏳ **${target.user.tag}** est muet pour ${duration} minutes.` });
      }

      if (commandName === 'demute') {
        const target = options.getMember('membre');
        await target.timeout(null);
        return interaction.reply({ content: `🔊 Sourdine retirée pour **${target.user.tag}**.` });
      }

      if (commandName === 'avertir') {
        const target = options.getMember('membre');
        const reason = options.getString('raison');
        await target.send(`⚠️ Avertissement sur **${interaction.guild.name}** : ${reason}`).catch(() => {});
        return interaction.reply({ content: `⚠️ Avertissement envoyé à **${target.user.tag}**.` });
      }

      if (commandName === 'normaliser') {
        const target = options.getMember('membre');
        const cleanName = target.displayName.replace(/[^a-zA-Z0-9 ]/g, '') || 'Membre';
        await target.setNickname(cleanName);
        return interaction.reply({ content: `✅ Pseudo changé en : **${cleanName}**` });
      }

      if (commandName === 'setup-ticket') {
        const embed = new EmbedBuilder()
          .setTitle('・CENTRE D\'AIDE & SUPPORT')
          .setDescription('Besoin d\'aide ? Sélectionnez le type de ticket correspondant à votre demande.')
          .setColor(0x5865F2);

        const menu = new StringSelectMenuBuilder()
          .setCustomId('ticket_type_select')
          .setPlaceholder('📩 Sélectionner un type de ticket')
          .addOptions(
            Object.entries(TICKET_TYPES).map(([value, type]) => ({
              label: type.label,
              description: type.description,
              value,
              emoji: type.emoji
            }))
          );

        const row = new ActionRowBuilder().addComponents(menu);

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: 'Panneau envoyé !', ephemeral: true });
      }

      // ==========================================
      // NOUVELLES COMMANDES — Modération
      // ==========================================
      if (commandName === 'unban') {
        const userId = options.getString('user_id');
        await interaction.guild.members.unban(userId);
        await sendModLog(interaction.guild, new EmbedBuilder().setColor(0x57F287).setTitle('✅ Débanni').setDescription(`Utilisateur \`${userId}\` débanni par ${interaction.user}.`));
        return interaction.reply({ content: `✅ Utilisateur (${userId}) débanni avec succès.` });
      }

      if (commandName === 'kick') {
        const target = options.getMember('membre');
        const reason = options.getString('raison') || 'Aucune raison';
        if (!target.kickable) return interaction.reply({ content: '❌ Je ne peux pas expulser ce membre.', ephemeral: true });
        await target.kick(reason);
        await sendModLog(interaction.guild, new EmbedBuilder().setColor(0xED4245).setTitle('👢 Kick').setDescription(`${target.user.tag} expulsé par ${interaction.user}.\nRaison : ${reason}`));
        return interaction.reply({ content: `✅ **${target.user.tag}** a été expulsé.` });
      }

      if (commandName === 'timeout') {
        const target = options.getMember('membre');
        const duration = options.getInteger('duree');
        const reason = options.getString('raison') || 'Aucune raison';
        await target.timeout(duration * 60 * 1000, reason);
        await sendModLog(interaction.guild, new EmbedBuilder().setColor(0xFEE75C).setTitle('⏳ Timeout').setDescription(`${target.user.tag} mis en timeout ${duration} min par ${interaction.user}.\nRaison : ${reason}`));
        return interaction.reply({ content: `⏳ **${target.user.tag}** est en timeout pour ${duration} minutes.` });
      }

      if (commandName === 'untimeout') {
        const target = options.getMember('membre');
        await target.timeout(null);
        return interaction.reply({ content: `🔊 Timeout retiré pour **${target.user.tag}**.` });
      }

      if (commandName === 'warn') {
        const target = options.getMember('membre');
        const reason = options.getString('raison');
        const list = getWarnings(interaction.guild.id, target.id);
        const entry = { id: list.length ? list[list.length - 1].id + 1 : 1, reason, moderatorId: interaction.user.id, date: new Date().toISOString() };
        list.push(entry);
        saveWarnings();
        await target.send(`⚠️ Tu as reçu un avertissement sur **${interaction.guild.name}** : ${reason}`).catch(() => {});
        await sendModLog(interaction.guild, new EmbedBuilder().setColor(0xFEE75C).setTitle('⚠️ Avertissement').setDescription(`${target.user.tag} averti par ${interaction.user}.\nRaison : ${reason}`));
        return interaction.reply({ content: `⚠️ **${target.user.tag}** a reçu l'avertissement #${entry.id}.` });
      }

      if (commandName === 'warnings') {
        const target = options.getUser('membre');
        const list = getWarnings(interaction.guild.id, target.id);
        const embed = new EmbedBuilder()
          .setTitle(`⚠️ Avertissements de ${target.tag}`)
          .setColor(0xFEE75C)
          .setDescription(list.length ? list.map(w => `**#${w.id}** — ${w.reason} (<@${w.moderatorId}>, ${new Date(w.date).toLocaleDateString('fr-FR')})`).join('\n') : 'Aucun avertissement.');
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'clear') {
        const amount = options.getInteger('nombre');
        if (amount < 1 || amount > 100) return interaction.reply({ content: '❌ Le nombre doit être entre 1 et 100.', ephemeral: true });
        const deleted = await interaction.channel.bulkDelete(amount, true);
        return interaction.reply({ content: `🧹 ${deleted.size} message(s) supprimé(s).`, ephemeral: true });
      }

      if (commandName === 'slowmode') {
        const seconds = options.getInteger('secondes');
        await interaction.channel.setRateLimitPerUser(seconds);
        return interaction.reply({ content: seconds > 0 ? `🐌 Mode lent réglé sur ${seconds}s.` : '✅ Mode lent désactivé.' });
      }

      if (commandName === 'lock') {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
        return interaction.reply({ content: '🔒 Salon verrouillé.' });
      }

      if (commandName === 'unlock') {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
        return interaction.reply({ content: '🔓 Salon déverrouillé.' });
      }

      if (commandName === 'nick') {
        const target = options.getMember('membre');
        const newNick = options.getString('pseudo');
        await target.setNickname(newNick);
        return interaction.reply({ content: `✅ Pseudo changé en : **${newNick}**` });
      }

      if (commandName === 'role') {
        const target = options.getMember('membre');
        const role = options.getRole('role');
        const action = options.getString('action');
        if (action === 'add') await target.roles.add(role);
        else await target.roles.remove(role);
        return interaction.reply({ content: action === 'add' ? `✅ Rôle **${role.name}** ajouté à ${target}.` : `✅ Rôle **${role.name}** retiré à ${target}.` });
      }

      if (commandName === 'voicemute') {
        const target = options.getMember('membre');
        await target.voice.setMute(true);
        return interaction.reply({ content: `🔇 **${target.user.tag}** est muet en vocal.` });
      }

      if (commandName === 'voiceunmute') {
        const target = options.getMember('membre');
        await target.voice.setMute(false);
        return interaction.reply({ content: `🔊 Sourdine vocale retirée pour **${target.user.tag}**.` });
      }

      // ==========================================
      // NOUVELLES COMMANDES — Informations / utilitaires
      // ==========================================
      if (commandName === 'userinfo') {
        const target = options.getMember('membre') || interaction.member;
        const embed = new EmbedBuilder()
          .setTitle(`👤 ${target.user.tag}`)
          .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
          .setColor(0x5865F2)
          .addFields(
            { name: 'ID', value: target.id, inline: true },
            { name: 'Compte créé le', value: target.user.createdAt.toLocaleDateString('fr-FR'), inline: true },
            { name: 'A rejoint le', value: target.joinedAt ? target.joinedAt.toLocaleDateString('fr-FR') : 'Inconnu', inline: true },
            { name: 'Rôles', value: target.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r).join(' ') || 'Aucun' }
          );
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'avatar') {
        const target = options.getUser('membre') || interaction.user;
        const embed = new EmbedBuilder().setTitle(`Avatar de ${target.tag}`).setImage(target.displayAvatarURL({ size: 1024 })).setColor(0x5865F2);
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'banner') {
        const target = options.getUser('membre') || interaction.user;
        const fetched = await client.users.fetch(target.id, { force: true });
        const bannerURL = fetched.bannerURL({ size: 1024 });
        if (!bannerURL) return interaction.reply({ content: 'ℹ️ Ce membre n\'a pas de bannière.', ephemeral: true });
        const embed = new EmbedBuilder().setTitle(`Bannière de ${target.tag}`).setImage(bannerURL).setColor(0x5865F2);
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'serverinfo') {
        const guild = interaction.guild;
        const embed = new EmbedBuilder()
          .setTitle(`🏠 ${guild.name}`)
          .setThumbnail(guild.iconURL({ size: 256 }))
          .setColor(0x5865F2)
          .addFields(
            { name: 'Propriétaire', value: `<@${guild.ownerId}>`, inline: true },
            { name: 'Membres', value: `${guild.memberCount}`, inline: true },
            { name: 'Créé le', value: guild.createdAt.toLocaleDateString('fr-FR'), inline: true },
            { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true },
            { name: 'Rôles', value: `${guild.roles.cache.size}`, inline: true }
          );
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'roles') {
        const roles = interaction.guild.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
        const embed = new EmbedBuilder().setTitle(`Rôles de ${interaction.guild.name} (${roles.size})`).setColor(0x5865F2)
          .setDescription(roles.map(r => `${r}`).join(' ') || 'Aucun rôle.');
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'membercount') {
        return interaction.reply({ content: `👥 Ce serveur compte **${interaction.guild.memberCount}** membres.` });
      }

      if (commandName === 'joined') {
        const target = options.getMember('membre') || interaction.member;
        return interaction.reply({ content: `📅 **${target.user.tag}** a rejoint le serveur le ${target.joinedAt.toLocaleDateString('fr-FR')}.` });
      }

      if (commandName === 'ping') {
        const sent = await interaction.reply({ content: '🏓 Calcul en cours...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        return interaction.editReply({ content: `🏓 Pong ! Latence : ${latency}ms | API : ${Math.round(client.ws.ping)}ms` });
      }

      if (commandName === 'botinfo') {
        const uptimeSec = Math.floor(client.uptime / 1000);
        const embed = new EmbedBuilder()
          .setTitle(`🤖 ${client.user.username}`)
          .setThumbnail(client.user.displayAvatarURL())
          .setColor(0x5865F2)
          .addFields(
            { name: 'Serveurs', value: `${client.guilds.cache.size}`, inline: true },
            { name: 'Uptime', value: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`, inline: true },
            { name: 'Librairie', value: 'discord.js', inline: true }
          );
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'stats') {
        const embed = new EmbedBuilder()
          .setTitle('📊 Statistiques du bot')
          .setColor(0x5865F2)
          .addFields(
            { name: 'Serveurs', value: `${client.guilds.cache.size}`, inline: true },
            { name: 'Utilisateurs (cache)', value: `${client.users.cache.size}`, inline: true },
            { name: 'Ping API', value: `${Math.round(client.ws.ping)}ms`, inline: true }
          );
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'invite') {
        const link = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;
        return interaction.reply({ content: `🔗 Invite-moi avec ce lien : ${link}` });
      }

      if (commandName === 'support') {
        const link = process.env.SUPPORT_SERVER_URL || 'Aucun lien de support configuré (définis SUPPORT_SERVER_URL dans .env).';
        return interaction.reply({ content: `🆘 Serveur de support : ${link}`, ephemeral: true });
      }

      if (commandName === 'help') {
        // Génère la liste à partir de TOUTES les commandes réellement enregistrées (auto-synchronisé)
        const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
        const lines = sorted.map(c => `\`/${c.name}\` — ${c.description}`);

        // Regroupe les lignes en blocs < 1000 caractères (limite Discord par champ)
        const fields = [];
        let current = '';
        let part = 1;
        for (const line of lines) {
          if ((current + '\n' + line).length > 1000) {
            fields.push({ name: `Commandes (${part})`, value: current });
            current = line;
            part++;
          } else {
            current = current ? `${current}\n${line}` : line;
          }
        }
        if (current) fields.push({ name: `Commandes (${part})`, value: current });

        const embed = new EmbedBuilder()
          .setTitle(`📖 Commandes disponibles (${sorted.length})`)
          .setColor(0x5865F2)
          .addFields(fields.slice(0, 25)); // limite Discord : 25 champs max par embed

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // ==========================================
      // NOUVELLES COMMANDES — Tickets
      // ==========================================
      if (commandName === 'ticket') {
        const type = TICKET_TYPES.report_player; // ticket générique par défaut
        const channelName = `ticket-${interaction.user.username}`;
        const existing = interaction.guild.channels.cache.find(c => c.name === channelName);
        if (existing) return interaction.reply({ content: `❌ Tu as déjà un ticket ouvert : ${existing}`, ephemeral: true });

        const channel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          topic: `🎫 Ticket support | Ouvert par ${interaction.user.tag} | ID:${interaction.user.id}`,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
          ],
        });

        const embed = new EmbedBuilder().setTitle('🎫 Ticket support').setDescription('Merci de décrire ta demande, un membre du staff va te répondre.').setColor(0x5865F2);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger));
        await channel.send({ content: `Bonjour ${interaction.user},`, embeds: [embed], components: [row] });
        return interaction.reply({ content: `✅ Ticket créé : ${channel}`, ephemeral: true });
      }

      if (['close', 'reopen', 'add', 'remove', 'rename', 'claim', 'unclaim', 'transcript'].includes(commandName)) {
        const channel = interaction.channel;
        const isTicket = (channel.topic || '').includes('ID:') || (ticketsDB[channel.id] !== undefined);
        if (!isTicket) return interaction.reply({ content: '❌ Cette commande ne peut être utilisée que dans un salon de ticket.', ephemeral: true });
        if (!ticketsDB[channel.id]) ticketsDB[channel.id] = { claimedBy: null, closed: false };
        const ticket = ticketsDB[channel.id];

        if (commandName === 'close') {
          await interaction.reply('🔒 Fermeture du ticket (archivage), transcription en cours...');
          await closeTicketChannel(channel, interaction.user);
          return;
        }

        if (commandName === 'reopen') {
          if (!ticket.closed) return interaction.reply({ content: 'ℹ️ Ce ticket n\'est pas fermé.', ephemeral: true });
          const opener = channel.topic.match(/ID:(\d+)/);
          await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
          if (opener) await channel.permissionOverwrites.edit(opener[1], { ViewChannel: true, SendMessages: true });
          const newName = channel.name.replace(/^ferme-/, '');
          await channel.setName(newName).catch(() => {});
          ticket.closed = false;
          saveTickets();
          return interaction.reply(`🔓 Ticket rouvert par ${interaction.user}.`);
        }

        if (commandName === 'add') {
          const target = options.getMember('membre');
          await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true });
          return interaction.reply(`✅ ${target} a été ajouté au ticket.`);
        }

        if (commandName === 'remove') {
          const target = options.getMember('membre');
          await channel.permissionOverwrites.edit(target.id, { ViewChannel: false });
          return interaction.reply(`✅ ${target} a été retiré du ticket.`);
        }

        if (commandName === 'rename') {
          const newName = options.getString('nom');
          await channel.setName(newName);
          return interaction.reply(`✅ Salon renommé en **${newName}**.`);
        }

        if (commandName === 'claim') {
          if (ticket.claimedBy) return interaction.reply({ content: `❌ Ce ticket est déjà réclamé par <@${ticket.claimedBy}>.`, ephemeral: true });
          ticket.claimedBy = interaction.user.id;
          saveTickets();
          return interaction.reply(`🙋 Ticket réclamé par ${interaction.user}.`);
        }

        if (commandName === 'unclaim') {
          ticket.claimedBy = null;
          saveTickets();
          return interaction.reply(`↩️ Ticket libéré par ${interaction.user}.`);
        }

        if (commandName === 'transcript') {
          await interaction.deferReply({ ephemeral: true });
          const attachment = await generateTranscript(channel);
          return interaction.editReply({ content: '📄 Voici la transcription actuelle :', files: [attachment] });
        }
      }

      // ==========================================
      // NOUVELLES COMMANDES — Communication
      // ==========================================
      if (commandName === 'announce') {
        const targetChannel = options.getChannel('salon');
        const message = options.getString('message');
        const embed = new EmbedBuilder().setTitle('📢 Annonce').setDescription(message).setColor(0x5865F2).setTimestamp();
        await targetChannel.send({ embeds: [embed] });
        return interaction.reply({ content: `✅ Annonce envoyée dans ${targetChannel}.`, ephemeral: true });
      }

      if (commandName === 'embed') {
        const targetChannel = options.getChannel('salon');
        const title = options.getString('titre');
        const description = options.getString('description');
        const colorInput = options.getString('couleur');
        let color = 0x5865F2;
        if (colorInput && /^#?[0-9A-Fa-f]{6}$/.test(colorInput)) color = parseInt(colorInput.replace('#', ''), 16);
        const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
        await targetChannel.send({ embeds: [embed] });
        return interaction.reply({ content: `✅ Embed envoyé dans ${targetChannel}.`, ephemeral: true });
      }

      if (commandName === 'say') {
        const targetChannel = options.getChannel('salon');
        const message = options.getString('message');
        await targetChannel.send({ content: message });
        return interaction.reply({ content: `✅ Message envoyé dans ${targetChannel}.`, ephemeral: true });
      }

      if (commandName === 'dm') {
        const target = options.getUser('membre');
        const message = options.getString('message');
        const sent = await target.send(message).catch(() => null);
        return interaction.reply({ content: sent ? `✅ Message envoyé à ${target}.` : `❌ Impossible d'envoyer un MP à ${target} (MPs fermés).`, ephemeral: true });
      }

      if (commandName === 'maintenance') {
        const state = options.getBoolean('etat');
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.maintenance = state;
        saveConfigs();
        return interaction.reply({ content: state ? '🛠️ Mode maintenance **activé**.' : '✅ Mode maintenance **désactivé**.', ephemeral: true });
      }

      // ==========================================
      // NOUVELLES COMMANDES — Configuration
      // ==========================================
      if (commandName === 'setwelcome') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.welcomeChannelId = options.getChannel('salon').id;
        cfg.welcomeMessage = options.getString('message');
        saveConfigs();
        return interaction.reply({ content: '✅ Message de bienvenue configuré.', ephemeral: true });
      }

      if (commandName === 'setgoodbye') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.goodbyeChannelId = options.getChannel('salon').id;
        cfg.goodbyeMessage = options.getString('message');
        saveConfigs();
        return interaction.reply({ content: '✅ Message d\'au revoir configuré.', ephemeral: true });
      }

      if (commandName === 'setlog') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.logChannelId = options.getChannel('salon').id;
        saveConfigs();
        return interaction.reply({ content: '✅ Salon de logs configuré.', ephemeral: true });
      }

      if (commandName === 'setmodlog') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.modlogChannelId = options.getChannel('salon').id;
        saveConfigs();
        return interaction.reply({ content: '✅ Salon de logs de modération configuré.', ephemeral: true });
      }

      if (commandName === 'setautorole') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.autoroleId = options.getRole('role').id;
        saveConfigs();
        return interaction.reply({ content: '✅ Rôle automatique configuré.', ephemeral: true });
      }

      if (commandName === 'setticket') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.ticketLogChannelId = options.getChannel('salon').id;
        saveConfigs();
        return interaction.reply({ content: '✅ Salon de logs des tickets configuré.', ephemeral: true });
      }

      if (commandName === 'setprefix') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.prefix = options.getString('prefixe');
        saveConfigs();
        return interaction.reply({ content: `✅ Préfixe cosmétique défini sur \`${cfg.prefix}\` (le bot ne fonctionne qu'avec les commandes slash, ce préfixe n'a qu'un usage d'affichage).`, ephemeral: true });
      }

      if (commandName === 'setlanguage') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.language = options.getString('langue');
        saveConfigs();
        return interaction.reply({ content: `✅ Langue définie sur \`${cfg.language}\`.`, ephemeral: true });
      }

      if (commandName === 'setup') {
        const embed = new EmbedBuilder().setTitle('・CENTRE D\'AIDE & SUPPORT').setDescription('Besoin d\'aide ? Sélectionnez le type de ticket correspondant à votre demande.').setColor(0x5865F2);
        const menu = new StringSelectMenuBuilder().setCustomId('ticket_type_select').setPlaceholder('📩 Sélectionner un type de ticket')
          .addOptions(Object.entries(TICKET_TYPES).map(([value, type]) => ({ label: type.label, description: type.description, value, emoji: type.emoji })));
        const row = new ActionRowBuilder().addComponents(menu);
        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: 'Panneau envoyé !', ephemeral: true });
      }

      if (commandName === 'config') {
        const cfg = getGuildConfig(interaction.guild.id);
        const embed = new EmbedBuilder()
          .setTitle(`⚙️ Configuration de ${interaction.guild.name}`)
          .setColor(0x5865F2)
          .addFields(
            { name: 'Salon bienvenue', value: cfg.welcomeChannelId ? `<#${cfg.welcomeChannelId}>` : 'Non défini', inline: true },
            { name: 'Salon au revoir', value: cfg.goodbyeChannelId ? `<#${cfg.goodbyeChannelId}>` : 'Non défini', inline: true },
            { name: 'Salon logs', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Non défini', inline: true },
            { name: 'Salon logs modération', value: cfg.modlogChannelId ? `<#${cfg.modlogChannelId}>` : 'Non défini', inline: true },
            { name: 'Salon logs tickets', value: cfg.ticketLogChannelId ? `<#${cfg.ticketLogChannelId}>` : (TICKET_LOG_CHANNEL_ID ? `<#${TICKET_LOG_CHANNEL_ID}> (.env)` : 'Non défini'), inline: true },
            { name: 'Rôle automatique', value: cfg.autoroleId ? `<@&${cfg.autoroleId}>` : 'Non défini', inline: true },
            { name: 'Préfixe (cosmétique)', value: cfg.prefix || 'Non défini', inline: true },
            { name: 'Langue', value: cfg.language || 'fr', inline: true },
            { name: 'Maintenance', value: cfg.maintenance ? 'Activée' : 'Désactivée', inline: true }
          );
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // Réponse automatique pour les sous-commandes
      if (!interaction.replied) {
        let sub = '';
        try { sub = options.getSubcommand(); } catch (e) {}
        const fullCmd = sub ? `${commandName} ${sub}` : commandName;
        return interaction.reply({ content: `⚙️ Commande **/${fullCmd}** exécutée !`, ephemeral: true });
      }

    } catch (err) {
      console.error(err);
      if (!interaction.replied) {
        return interaction.reply({ content: '❌ Une erreur est survenue lors de l\'exécution.', ephemeral: true });
      }
    }
  }

  // B. Menu déroulant (choix du type de ticket)
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_select') {
    try {
      const type = TICKET_TYPES[interaction.values[0]];
      if (!type) return interaction.reply({ content: '❌ Type de ticket inconnu.', ephemeral: true });

      const channelName = `${type.prefix}-${interaction.user.username}`;
      const existing = interaction.guild.channels.cache.find(c => c.name === channelName);
      if (existing) return interaction.reply({ content: `❌ Tu as déjà un ticket ouvert pour ce type : ${existing}`, ephemeral: true });

      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: `🎫 ${type.label} | Ouvert par ${interaction.user.tag} | ID:${interaction.user.id}`,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
        ],
      });

      const embed = new EmbedBuilder()
        .setTitle(`${type.emoji} ${type.label}`)
        .setDescription(type.welcome)
        .setColor(0x5865F2);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger)
      );

      await channel.send({ content: `Bonjour ${interaction.user},`, embeds: [embed], components: [row] });
      return interaction.reply({ content: `✅ Ticket créé : ${channel}`, ephemeral: true });
    } catch (err) {
      console.error('Erreur lors de la création du ticket :', err);
      if (!interaction.replied) {
        return interaction.reply({ content: `❌ Une erreur est survenue lors de la création du ticket : \`${err.message}\``, ephemeral: true }).catch(() => {});
      }
    }
  }

  // C. Boutons (Ticket)
  if (interaction.isButton()) {
    if (interaction.customId === 'close_ticket') {
     try {
      await interaction.reply('🔒 Génération de la transcription et archivage du ticket...');
      const channel = interaction.channel;
      await closeTicketChannel(channel, interaction.user);
     } catch (err) {
       console.error('Erreur lors de la fermeture du ticket :', err);
       if (!interaction.replied) {
         await interaction.reply({ content: `❌ Une erreur est survenue lors de la fermeture : \`${err.message}\``, ephemeral: true }).catch(() => {});
       }
     }
    }
  }
});

// ==========================================
// 4. BIENVENUE / AU REVOIR / RÔLE AUTOMATIQUE
// ==========================================
function formatTemplate(str, member) {
  return str
    .replace(/\{membre\}/g, `${member}`)
    .replace(/\{serveur\}/g, member.guild.name);
}

client.on('guildMemberAdd', async member => {
  const cfg = getGuildConfig(member.guild.id);

  if (cfg.autoroleId) {
    const role = member.guild.roles.cache.get(cfg.autoroleId);
    if (role) await member.roles.add(role).catch(() => {});
  }

  if (cfg.welcomeChannelId) {
    const channel = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
    if (channel) {
      channel.send({ content: formatTemplate(cfg.welcomeMessage || 'Bienvenue {membre} sur **{serveur}** !', member) }).catch(() => {});
    }
  }
});

client.on('guildMemberRemove', async member => {
  const cfg = getGuildConfig(member.guild.id);
  if (cfg.goodbyeChannelId) {
    const channel = await member.guild.channels.fetch(cfg.goodbyeChannelId).catch(() => null);
    if (channel) {
      channel.send({ content: formatTemplate(cfg.goodbyeMessage || '👋 {membre} a quitté **{serveur}**.', member) }).catch(() => {});
    }
  }
});

// ==========================================
// 1b. PANEL DE CANDIDATURE STAFF (/setup-staff)
// Bouton -> formulaire -> un admin accepte/refuse -> rôle candidat staff
// ==========================================
// staffDB[guildId] = { channelId, roleId, pending: { userId: true } }
const staffDB = loadJSON('staff.json', {});
function saveStaff() { saveJSON('staff.json', staffDB); }

// ---------- La commande /setup-staff ----------
const staffCommand = new SlashCommandBuilder()
  .setName('setup-staff')
  .setDescription('Afficher le panel de candidature staff dans ce salon.')
  .addChannelOption(opt => opt
    .setName('salon_candidatures')
    .setDescription('Salon où les admins reçoivent les candidatures')
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addRoleOption(opt => opt
    .setName('role_candidat')
    .setDescription('Rôle donné quand une candidature est acceptée (ex : Candidat staff)')
    .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ---------- /setup-staff ----------
async function staffHandleSetup(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: '❌ Cette commande fonctionne uniquement dans un serveur.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Seuls les administrateurs peuvent utiliser cette commande.',
      flags: MessageFlags.Ephemeral
    });
  }

  const channel = interaction.options.getChannel('salon_candidatures');
  const role = interaction.options.getRole('role_candidat');
  const guildId = interaction.guild.id;

  staffDB[guildId] = {
    channelId: channel.id,
    roleId: role.id,
    pending: (staffDB[guildId] && staffDB[guildId].pending) || {}
  };
  saveStaff();

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🛡️ Rejoindre le staff')
    .setDescription(
      'Tu veux aider à faire vivre le serveur ?\n\n' +
      'Clique sur le bouton ci-dessous et remplis le formulaire.\n' +
      'Un administrateur lira ta candidature et te répondra en message privé.'
    )
    .setFooter({ text: 'Une seule candidature à la fois.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('staff_apply')
      .setLabel('Postuler au staff')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });

  const warnings = [];
  const me = interaction.guild.members.me;

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    warnings.push('⚠️ Le bot n\'a pas la permission **Gérer les rôles**.');
  }

  if (role.managed || role.position >= me.roles.highest.position) {
    warnings.push(
      '⚠️ Le rôle du bot doit être **placé au-dessus** du rôle ' +
      role.toString() + ' dans la liste des rôles du serveur.'
    );
  }

  return interaction.reply({
    content: '✅ Panel envoyé ! Les candidatures arriveront dans ' +
      channel.toString() +
      (warnings.length ? '\n\n' + warnings.join('\n') : ''),
    flags: MessageFlags.Ephemeral
  });
}

// ---------- Clic sur "Postuler" : affiche le formulaire ----------
async function staffShowModal(interaction) {
  const cfg = interaction.guild && staffDB[interaction.guild.id];

  if (!cfg) {
    return interaction.reply({
      content: '❌ Le panel n\'est pas configuré. Un admin doit utiliser `/setup-staff`.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.member.roles.cache.has(cfg.roleId)) {
    return interaction.reply({
      content: '✅ Tu as déjà le rôle candidat staff.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (cfg.pending[interaction.user.id]) {
    return interaction.reply({
      content: '⏳ Ta candidature est déjà en attente. Patiente jusqu\'à la réponse d\'un admin.',
      flags: MessageFlags.Ephemeral
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('staff_modal')
    .setTitle('Candidature staff');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('pseudo')
        .setLabel('Ton pseudo')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(50)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('experience')
        .setLabel('Ton expérience (modération, staff...)')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('motivation')
        .setLabel('Pourquoi veux-tu rejoindre le staff ?')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dispo')
        .setLabel('Tes disponibilités')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true)
    )
  );

  return interaction.showModal(modal);
}

// ---------- Envoi du formulaire : la candidature arrive chez les admins ----------
async function staffHandleModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = interaction.guild && staffDB[interaction.guild.id];

  if (!cfg) {
    return interaction.editReply('❌ Le panel n\'est pas configuré.');
  }

  if (cfg.pending[interaction.user.id]) {
    return interaction.editReply('⏳ Ta candidature est déjà en attente.');
  }

  const channel = await interaction.guild.channels
    .fetch(cfg.channelId)
    .catch(() => null);

  if (!channel) {
    return interaction.editReply(
      '❌ Le salon des candidatures est introuvable. Préviens un admin.'
    );
  }

  const user = interaction.user;

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('📝 Nouvelle candidature staff')
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Candidat', value: user.toString() + ' (`' + user.id + '`)' },
      { name: 'Pseudo', value: interaction.fields.getTextInputValue('pseudo') },
      { name: 'Expérience', value: interaction.fields.getTextInputValue('experience') },
      { name: 'Motivation', value: interaction.fields.getTextInputValue('motivation') },
      { name: 'Disponibilités', value: interaction.fields.getTextInputValue('dispo') },
      { name: 'Statut', value: '⏳ En attente d\'une décision' }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('staff_accept:' + user.id)
      .setLabel('Accepter')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('staff_refuse:' + user.id)
      .setLabel('Refuser')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  try {
    await channel.send({ embeds: [embed], components: [row] });
  } catch (e) {
    console.error('❌ Impossible d\'envoyer la candidature :', e);
    return interaction.editReply(
      '❌ Le bot ne peut pas écrire dans le salon des candidatures. Préviens un admin.'
    );
  }

  cfg.pending[user.id] = true;
  saveStaff();

  return interaction.editReply(
    '✅ Ta candidature a bien été envoyée ! Tu recevras la réponse en message privé.'
  );
}

// ---------- Boutons Accepter / Refuser ----------
async function staffHandleDecision(interaction) {
  const [action, userId] = interaction.customId.split(':');
  const accept = action === 'staff_accept';

  if (!interaction.guild) return;

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({
      content: '❌ Seuls les admins peuvent valider une candidature.',
      flags: MessageFlags.Ephemeral
    });
  }

  const cfg = staffDB[interaction.guild.id];

  if (!cfg) {
    return interaction.reply({
      content: '❌ Le panel n\'est pas configuré.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate();

  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (accept) {
    if (!member) {
      await staffFinish(
        interaction,
        cfg,
        userId,
        '⚠️ Le candidat a quitté le serveur.',
        0x99aab5
      );
      return;
    }

    try {
      await member.roles.add(
        cfg.roleId,
        'Candidature staff acceptée par ' + interaction.user.tag
      );
    } catch (e) {
      console.error('❌ Impossible de donner le rôle :', e);
      return interaction.followUp({
        content: '❌ Je n\'arrive pas à donner le rôle. Vérifie que le bot a la permission **Gérer les rôles** et que son rôle est **au-dessus** du rôle candidat.',
        flags: MessageFlags.Ephemeral
      });
    }

    await staffFinish(
      interaction,
      cfg,
      userId,
      '✅ Acceptée par ' + interaction.user.toString(),
      0x57f287
    );

    member.send(
      '🎉 Ta candidature staff sur **' + interaction.guild.name +
      '** a été **acceptée** ! Tu as reçu le rôle candidat staff.'
    ).catch(() => {});
  } else {
    await staffFinish(
      interaction,
      cfg,
      userId,
      '❌ Refusée par ' + interaction.user.toString(),
      0xed4245
    );

    const target = member
      ? member.user
      : await interaction.client.users.fetch(userId).catch(() => null);

    if (target) {
      target.send(
        '😕 Ta candidature staff sur **' + interaction.guild.name +
        '** a été **refusée** cette fois. Tu pourras réessayer plus tard.'
      ).catch(() => {});
    }
  }
}

// Met à jour le message de candidature (statut + boutons retirés)
async function staffFinish(interaction, cfg, userId, statusText, color) {
  delete cfg.pending[userId];
  saveStaff();

  const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(color);
  const fields = embed.data.fields || [];
  const idx = fields.findIndex(f => f.name === 'Statut');

  if (idx >= 0) fields[idx].value = statusText;

  embed.setFields(fields);

  await interaction.editReply({ embeds: [embed], components: [] });
}

// ---------- Branchement sur le bot ----------
async function staffHandle(interaction) {
  const isSetup = interaction.isChatInputCommand() &&
    interaction.commandName === 'setup-staff';
  const isApply = interaction.isButton() &&
    interaction.customId === 'staff_apply';
  const isModal = interaction.isModalSubmit() &&
    interaction.customId === 'staff_modal';
  const isDecision = interaction.isButton() &&
    /^staff_(accept|refuse):/.test(interaction.customId);

  if (!isSetup && !isApply && !isModal && !isDecision) return false;

  try {
    if (isSetup) await staffHandleSetup(interaction);
    else if (isApply) await staffShowModal(interaction);
    else if (isModal) await staffHandleModal(interaction);
    else await staffHandleDecision(interaction);
  } catch (err) {
    console.error('❌ Erreur panel staff :', err);
    const msg = {
      content: '❌ Une erreur est survenue.',
      flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
      interaction.followUp(msg).catch(() => {});
    } else {
      interaction.reply(msg).catch(() => {});
    }
  }

  return true;
}

commands.push(staffCommand.toJSON());

client.login(process.env.TOKEN);