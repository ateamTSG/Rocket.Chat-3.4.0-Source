import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';

import { Subscriptions, Rooms, Users } from '../../../models/client';
import { hasPermission } from '../../../authorization/client';
import { settings } from '../../../settings/client';
import { getUserPreference } from '../../../utils/client';
import { AutoTranslate } from '../../../autotranslate/client';

const fields = { name: 1, username: 1, 'settings.preferences.showMessageInMainThread': 1, 'settings.preferences.autoImageLoad': 1, 'settings.preferences.saveMobileBandwidth': 1, 'settings.preferences.collapseMediaByDefault': 1, 'settings.preferences.hideRoles': 1 };

export function messageContext({ rid } = Template.instance()) {
	const uid = Meteor.userId();
	const user = Users.findOne({ _id: uid }, { fields });
	return {
		u: user,
		room: Rooms.findOne({ _id: rid }, {
			reactive: false,
			fields: {
				_updatedAt: 0,
				lastMessage: 0,
			},
		}),
		subscription: Subscriptions.findOne({ rid }, {
			fields: {
				name: 1,
				autoTranslate: 1,
				rid: 1,
				tunread: 1,
				tunreadUser: 1,
				tunreadGroup: 1,
			},
		}),
		settings: {
			translateLanguage: AutoTranslate.getLanguage(rid),
			showMessageInMainThread: getUserPreference(user, 'showMessageInMainThread'),
			autoImageLoad: getUserPreference(user, 'autoImageLoad'),
			saveMobileBandwidth: Meteor.Device.isPhone() && getUserPreference(user, 'saveMobileBandwidth'),
			collapseMediaByDefault: getUserPreference(user, 'collapseMediaByDefault'),
			showreply: true,
			showReplyButton: true,
			hasPermissionDeleteMessage: hasPermission('delete-message', rid),
			hasPermissionDeleteOwnMessage: hasPermission('delete-own-message'),
			hideRoles: !settings.get('UI_DisplayRoles') || getUserPreference(user, 'hideRoles'),
			UI_Use_Real_Name: settings.get('UI_Use_Real_Name'),
			Chatops_Username: settings.get('Chatops_Username'),
			AutoTranslate_Enabled: settings.get('AutoTranslate_Enabled'),
			Message_AllowEditing: settings.get('Message_AllowEditing'),
			Message_AllowEditing_BlockEditInMinutes: settings.get('Message_AllowEditing_BlockEditInMinutes'),
			Message_ShowEditedStatus: settings.get('Message_ShowEditedStatus'),
			API_Embed: settings.get('API_Embed'),
			API_EmbedDisabledFor: settings.get('API_EmbedDisabledFor'),
			Message_GroupingPeriod: settings.get('Message_GroupingPeriod') * 1000,
		},
	};
}
