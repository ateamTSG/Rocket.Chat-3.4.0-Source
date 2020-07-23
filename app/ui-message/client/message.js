import _ from 'underscore';
import s from 'underscore.string';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { Template } from 'meteor/templating';
import { Session } from 'meteor/session';
import { TAPi18n } from 'meteor/rocketchat:tap-i18n';

import { timeAgo, formatDateAndTime } from '../../lib/client/lib/formatDate';
import { DateFormat } from '../../lib/client';
import { normalizeThreadTitle } from '../../threads/client/lib/normalizeThreadTitle';
import { renderMessageBody, MessageTypes, MessageAction, call } from '../../ui-utils/client';
import { RoomRoles, UserRoles, Roles, Messages } from '../../models/client';
import { callbacks } from '../../callbacks/client';
import { Markdown } from '../../markdown/client';
import { t, roomTypes } from '../../utils';
import { upsertMessage } from '../../ui-utils/client/lib/RoomHistoryManager';
import './message.html';
import './messageThread';
import { AutoTranslate } from '../../autotranslate/client';


const renderBody = (msg, settings) => {
	const searchedText = msg.searchedText ? msg.searchedText : '';
	const isSystemMessage = MessageTypes.isSystemMessage(msg);
	const messageType = MessageTypes.getType(msg) || {};

	if (messageType.render) {
		msg = messageType.render(msg);
	} else if (messageType.template) {
		// render template
	} else if (messageType.message) {
		msg.msg = s.escapeHTML(msg.msg);
		msg = TAPi18n.__(messageType.message, { ...typeof messageType.data === 'function' && messageType.data(msg) });
	} else if (msg.u && msg.u.username === settings.Chatops_Username) {
		msg.html = msg.msg;
		msg = callbacks.run('renderMentions', msg);
		msg = msg.html;
	} else {
		msg = renderMessageBody(msg);
	}

	if (isSystemMessage) {
		msg.html = Markdown.parse(msg.html);
	}

	if (searchedText) {
		msg = msg.replace(new RegExp(searchedText, 'gi'), (str) => `<mark>${ str }</mark>`);
	}

	return msg;
};

const findParentMessage = (() => {
	const waiting = [];
	const uid = Tracker.nonreactive(() => Meteor.userId());
	const getMessages = _.debounce(async function() {
		const _tmp = [...waiting];
		waiting.length = 0;
		(await call('getMessages', _tmp)).map((msg) => Messages.findOne({ _id: msg._id }) || upsertMessage({ msg: { ...msg, _hidden: true }, uid }));
	}, 500);


	return (tmid) => {
		if (waiting.indexOf(tmid) > -1) {
			return;
		}
		const message = Messages.findOne({ _id: tmid });
		if (!message) {
			waiting.push(tmid);
			return getMessages();
		}
		return Messages.update(
			{ tmid, repliesCount: { $exists: 0 } },
			{
				$set: {
					following: message.replies && message.replies.indexOf(uid) > -1,
					threadMsg: normalizeThreadTitle(message),
					repliesCount: message.tcount,
				},
			},
			{ multi: true },
		);
	};
})();

Template.message.helpers({
	following() {
		const { msg, u } = this;
		return msg.replies && msg.replies.indexOf(u._id) > -1;
	},
	body() {
		const { msg, settings } = this;
		return Tracker.nonreactive(() => renderBody(msg, settings));
	},
	i18nReplyCounter() {
		const { msg } = this;
		if (msg.tcount === 1) {
			return 'reply_counter';
		}
		return 'reply_counter_plural';
	},
	i18nDiscussionCounter() {
		const { msg } = this;
		return `<span class='reply-counter'>${ msg.dcount }</span>`;
	},
	formatDateAndTime,
	encodeURI(text) {
		return encodeURI(text);
	},
	broadcast() {
		const { msg, room = {}, u } = this;
		return !msg.private && !msg.t && msg.u._id !== u._id && room && room.broadcast;
	},
	isIgnored() {
		const { ignored, msg } = this;
		const isIgnored = typeof ignored !== 'undefined' ? ignored : msg.ignored;
		return isIgnored;
	},
	ignoredClass() {
		const { ignored, msg } = this;
		const isIgnored = typeof ignored !== 'undefined' ? ignored : msg.ignored;
		return isIgnored ? 'message--ignored' : '';
	},
	isDecrypting() {
		const { msg } = this;
		return msg.e2e === 'pending';
	},
	isBot() {
		const { msg } = this;
		return msg.bot && 'bot';
	},
	roleTags() {
		const { msg, hideRoles, settings } = this;
		if (settings.hideRoles || hideRoles) {
			return [];
		}

		if (!msg.u || !msg.u._id) {
			return [];
		}
		const userRoles = UserRoles.findOne(msg.u._id);
		const roomRoles = RoomRoles.findOne({
			'u._id': msg.u._id,
			rid: msg.rid,
		});
		const roles = [...(userRoles && userRoles.roles) || [], ...(roomRoles && roomRoles.roles) || []];
		return Roles.find({
			_id: {
				$in: roles,
			},
			description: {
				$exists: 1,
				$ne: '',
			},
		}, {
			fields: {
				description: 1,
			},
		});
	},
	isGroupable() {
		const { msg, room = {}, settings, groupable } = this;
		if (groupable === false || settings.allowGroup === false || room.broadcast || msg.groupable === false || (MessageTypes.isSystemMessage(msg) && !msg.tmid)) {
			return 'false';
		}
	},
	avatarFromUsername() {
		const { msg } = this;

		if (msg.avatar != null && msg.avatar[0] === '@') {
			return msg.avatar.replace(/^@/, '');
		}
	},
	getStatus() {
		const { msg } = this;
		return Session.get(`user_${ msg.u.username }_status_text`);
	},
	getName() {
		const { msg, settings } = this;
		if (msg.alias) {
			return msg.alias;
		}
		if (!msg.u) {
			return '';
		}
		return (settings.UI_Use_Real_Name && msg.u.name) || msg.u.username;
	},
	showUsername() {
		const { msg, settings } = this;
		return msg.alias || (settings.UI_Use_Real_Name && msg.u && msg.u.name);
	},
	own() {
		const { msg, u } = this;
		if (msg.u && msg.u._id === u._id) {
			return 'own';
		}
	},
	t() {
		const { msg } = this;
		return msg.t;
	},
	timestamp() {
		const { msg } = this;
		return +msg.ts;
	},
	chatops() {
		const { msg, settings } = this;
		if (msg.u && msg.u.username === settings.Chatops_Username) {
			return 'chatops-message';
		}
	},
	time() {
		const { msg, timeAgo: useTimeAgo } = this;

		return useTimeAgo ? timeAgo(msg.ts) : DateFormat.formatTime(msg.ts);
	},
	date() {
		const { msg } = this;
		return DateFormat.formatDate(msg.ts);
	},
	isTemp() {
		const { msg } = this;
		if (msg.temp === true) {
			return 'temp';
		}
	},
	threadMessage() {
		const { msg } = this;
		return normalizeThreadTitle(msg);
	},
	bodyClass() {
		const { msg } = this;
		return MessageTypes.isSystemMessage(msg) ? 'color-info-font-color' : 'color-primary-font-color';
	},
	system(returnClass) {
		const { msg } = this;
		if (MessageTypes.isSystemMessage(msg)) {
			if (returnClass) {
				return 'color-info-font-color';
			}
			return 'system';
		}
	},
	unread() {
		const { msg, subscription } = this;
		if (!subscription?.tunread?.includes(msg._id)) {
			return false;
		}

		const badgeClass = (() => {
			if (subscription.tunreadUser?.includes(msg._id)) {
				return 'badge--user-mentions';
			}
			if (subscription.tunreadGroup?.includes(msg._id)) {
				return 'badge--group-mentions';
			}
		})();

		return {
			class: badgeClass,
		};
	},
	showTranslated() {
		const { msg, subscription, settings, u } = this;
		if (settings.AutoTranslate_Enabled && msg.u && msg.u._id !== u._id && !MessageTypes.isSystemMessage(msg)) {
			const autoTranslate = subscription && subscription.autoTranslate;
			return msg.autoTranslateFetching || (!!autoTranslate !== !!msg.autoTranslateShowInverse && msg.translations && msg.translations[settings.translateLanguage]);
		}
	},
	translationProvider() {
		const instance = Template.instance();
		const { translationProvider } = instance.data.msg;
		return translationProvider && AutoTranslate.providersMetadata[translationProvider].displayName;
	},
	edited() {
		const { msg } = this;
		return msg.editedAt && !MessageTypes.isSystemMessage(msg);
	},
	editTime() {
		const { msg } = this;
		return msg.editedAt ? DateFormat.formatDateAndTime(msg.editedAt) : '';
	},
	editedBy() {
		const { msg } = this;
		if (!msg.editedAt) {
			return '';
		}
		// try to return the username of the editor,
		// otherwise a special "?" character that will be
		// rendered as a special avatar
		return (msg.editedBy && msg.editedBy.username) || '?';
	},
	label() {
		const { msg } = this;

		if (msg.i18nLabel) {
			return t(msg.i18nLabel);
		} if (msg.label) {
			return msg.label;
		}
	},
	hasOembed() {
		const { msg, settings } = this;
		// there is no URLs, there is no template to show the oembed (oembed package removed) or oembed is not enable
		if (!(msg.urls && msg.urls.length > 0) || !Template.oembedBaseWidget || !settings.API_Embed) {
			return false;
		}

		// check if oembed is disabled for message's sender
		if ((settings.API_EmbedDisabledFor || '').split(',').map((username) => username.trim()).includes(msg.u && msg.u.username)) {
			return false;
		}
		return true;
	},
	reactions() {
		const { msg: { reactions = {} }, u: { username: myUsername, name: myName } } = this;

		return Object.entries(reactions)
			.map(([emoji, reaction]) => {
				const myDisplayName = reaction.names ? myName : `@${ myUsername }`;
				const displayNames = reaction.names || reaction.usernames.map((username) => `@${ username }`);
				const selectedDisplayNames = displayNames.slice(0, 15).filter((displayName) => displayName !== myDisplayName);

				if (displayNames.some((displayName) => displayName === myDisplayName)) {
					selectedDisplayNames.unshift(t('You'));
				}

				let usernames;

				if (displayNames.length > 15) {
					usernames = `${ selectedDisplayNames.join(', ') } ${ t('And_more', { length: displayNames.length - 15 }).toLowerCase() }`;
				} else if (displayNames.length > 1) {
					usernames = `${ selectedDisplayNames.slice(0, -1).join(', ') } ${ t('and') } ${ selectedDisplayNames[selectedDisplayNames.length - 1] }`;
				} else {
					usernames = selectedDisplayNames[0];
				}

				return {
					emoji,
					count: displayNames.length,
					usernames,
					reaction: ` ${ t('Reacted_with').toLowerCase() } ${ emoji }`,
					userReacted: displayNames.indexOf(myDisplayName) > -1,
				};
			});
	},
	markUserReaction(reaction) {
		if (reaction.userReacted) {
			return {
				class: 'selected',
			};
		}
	},
	hideReactions() {
		const { msg } = this;
		if (_.isEmpty(msg.reactions)) {
			return 'hidden';
		}
	},
	hideMessageActions() {
		const { msg } = this;

		return msg.private || MessageTypes.isSystemMessage(msg);
	},
	actionLinks() {
		const { msg } = this;
		// remove 'method_id' and 'params' properties
		return _.map(msg.actionLinks, function(actionLink, key) {
			return _.extend({
				id: key,
			}, _.omit(actionLink, 'method_id', 'params'));
		});
	},
	hideActionLinks() {
		const { msg } = this;
		if (_.isEmpty(msg.actionLinks)) {
			return 'hidden';
		}
	},
	injectMessage(data, { _id, rid }) {
		data.msg = { _id, rid };
	},
	injectIndex(data, index) {
		data.index = index;
	},
	injectSettings(data, settings) {
		data.settings = settings;
	},
	className() {
		return this.msg.className;
	},
	channelName() {
		const { subscription } = this;
		// const subscription = Subscriptions.findOne({ rid: this.rid });
		return subscription && subscription.name;
	},
	roomIcon() {
		const { room } = this;
		if (room && room.t === 'd') {
			return 'at';
		}
		return roomTypes.getIcon(room);
	},
	customClass() {
		const { customClass, msg } = this;
		return customClass || msg.customClass;
	},
	fromSearch() {
		const { customClass, msg } = this;
		return [msg.customClass, customClass].includes('search');
	},
	actionContext() {
		const { msg } = this;
		return msg.actionContext;
	},
	messageActions(group) {
		const { msg, context: ctx } = this;
		let messageGroup = group;
		let context = ctx || msg.actionContext;

		if (!group) {
			messageGroup = 'message';
		}

		if (!context) {
			context = 'message';
		}

		return MessageAction.getButtons(this, context, messageGroup);
	},
	isSnippet() {
		const { msg } = this;
		return msg.actionContext === 'snippeted';
	},
	isThreadReply() {
		const { groupable, msg: { tmid, t, groupable: _groupable }, settings: { showreply } } = this;
		return !(groupable === true || _groupable === true) && !!(tmid && showreply && (!t || t === 'e2e'));
	},
	shouldHideBody() {
		const { msg: { tmid }, settings: { showreply } } = this;
		return showreply && tmid;
	},
	collapsed() {
		const { msg: { tmid, collapsed }, settings: { showreply }, shouldCollapseReplies } = this;
		const isCollapsedThreadReply = shouldCollapseReplies && tmid && showreply && collapsed !== false;
		if (isCollapsedThreadReply) {
			return 'collapsed';
		}
	},
	collapseSwitchClass() {
		const { msg: { collapsed = true } } = this;
		return collapsed ? 'icon-right-dir' : 'icon-down-dir';
	},
	parentMessage() {
		const { msg: { threadMsg } } = this;
		return threadMsg;
	},
	showStar() {
		const { msg } = this;
		return msg.starred && !(msg.actionContext === 'starred' || this.context === 'starred');
	},
});


Template.message.onCreated(function() {
	const { msg, shouldCollapseReplies } = Template.currentData();
	if (shouldCollapseReplies && msg.tmid && !msg.threadMsg) {
		findParentMessage(msg.tmid);
	}
});

const hasTempClass = (node) => node.classList.contains('temp');

const getPreviousSentMessage = (currentNode) => {
	if (hasTempClass(currentNode)) {
		return currentNode.previousElementSibling;
	}
	if (currentNode.previousElementSibling != null) {
		let previousValid = currentNode.previousElementSibling;
		while (previousValid != null && (hasTempClass(previousValid) || !previousValid.classList.contains('message'))) {
			previousValid = previousValid.previousElementSibling;
		}
		return previousValid;
	}
};

const isNewDay = (currentNode, previousNode, forceDate, showDateSeparator) => {
	if (!showDateSeparator) {
		return false;
	}

	if (forceDate || !previousNode) {
		return true;
	}

	const { dataset: currentDataset } = currentNode;
	const { dataset: previousDataset } = previousNode;
	const previousMessageDate = new Date(parseInt(previousDataset.timestamp));
	const currentMessageDate = new Date(parseInt(currentDataset.timestamp));

	if (previousMessageDate.toDateString() !== currentMessageDate.toDateString()) {
		return true;
	}

	return false;
};

const isSequential = (currentNode, previousNode, forceDate, period, showDateSeparator, shouldCollapseReplies) => {
	if (!previousNode) {
		return false;
	}

	if (showDateSeparator && forceDate) {
		return false;
	}

	const { dataset: currentDataset } = currentNode;
	const { dataset: previousDataset } = previousNode;
	const previousMessageDate = new Date(parseInt(previousDataset.timestamp));
	const currentMessageDate = new Date(parseInt(currentDataset.timestamp));

	if (showDateSeparator && previousMessageDate.toDateString() !== currentMessageDate.toDateString()) {
		return false;
	}

	if (!shouldCollapseReplies && currentDataset.tmid) {
		return previousDataset.id === currentDataset.tmid || previousDataset.tmid === currentDataset.tmid;
	}

	if (previousDataset.tmid && !currentDataset.tmid) {
		return false;
	}

	if ([previousDataset.groupable, currentDataset.groupable].includes('false')) {
		return false;
	}

	if (previousDataset.username !== currentDataset.username) {
		return false;
	}

	if (previousDataset.alias !== currentDataset.alias) {
		return false;
	}

	if (parseInt(currentDataset.timestamp) - parseInt(previousDataset.timestamp) <= period) {
		return true;
	}

	return false;
};

const processSequentials = ({ index, currentNode, settings, forceDate, showDateSeparator = true, groupable, shouldCollapseReplies }) => {
	if (!showDateSeparator && !groupable) {
		return;
	}
	// const currentDataset = currentNode.dataset;
	const previousNode = (index === undefined || index > 0) && getPreviousSentMessage(currentNode);
	const nextNode = currentNode.nextElementSibling;

	if (isSequential(currentNode, previousNode, forceDate, settings.Message_GroupingPeriod, showDateSeparator, shouldCollapseReplies)) {
		currentNode.classList.add('sequential');
	} else {
		currentNode.classList.remove('sequential');
	}

	if (isNewDay(currentNode, previousNode, forceDate, showDateSeparator)) {
		currentNode.classList.add('new-day');
	} else {
		currentNode.classList.remove('new-day');
	}

	if (nextNode && nextNode.dataset) {
		if (isSequential(nextNode, currentNode, forceDate, settings.Message_GroupingPeriod, showDateSeparator, shouldCollapseReplies)) {
			nextNode.classList.add('sequential');
		} else {
			nextNode.classList.remove('sequential');
		}

		if (isNewDay(nextNode, currentNode, forceDate, showDateSeparator)) {
			nextNode.classList.add('new-day');
		} else {
			nextNode.classList.remove('new-day');
		}
	}
};

Template.message.onRendered(function() {
	const currentNode = this.firstNode;
	this.autorun(() => processSequentials({ currentNode, ...Template.currentData() }));
});
