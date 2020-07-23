import s from 'underscore.string';

import { Logger } from '../../../logger';
import { settings } from '../../../settings';
import { Users } from '../../../models/server';
import { hasPermission } from '../../../authorization';

const logger = new Logger('getFullUserData');

const defaultFields = {
	name: 1,
	username: 1,
	status: 1,
	utcOffset: 1,
	type: 1,
	active: 1,
	reason: 1,
	statusText: 1,
	avatarETag: 1,
};

const fullFields = {
	emails: 1,
	phone: 1,
	statusConnection: 1,
	bio: 1,
	createdAt: 1,
	lastLogin: 1,
	services: 1,
	requirePasswordChange: 1,
	requirePasswordChangeReason: 1,
	roles: 1,
};

let publicCustomFields = {};
let customFields = {};

settings.get('Accounts_CustomFields', (key, value) => {
	publicCustomFields = {};
	customFields = {};

	if (!value.trim()) {
		return;
	}

	try {
		const customFieldsOnServer = JSON.parse(value.trim());
		Object.keys(customFieldsOnServer).forEach((key) => {
			const element = customFieldsOnServer[key];
			if (element.public) {
				publicCustomFields[`customFields.${ key }`] = 1;
			}
			customFields[`customFields.${ key }`] = 1;
		});
	} catch (e) {
		logger.warn(`The JSON specified for "Accounts_CustomFields" is invalid. The following error was thrown: ${ e }`);
	}
});

const getCustomFields = (canViewAllInfo) => (canViewAllInfo ? customFields : publicCustomFields);

const getFields = (canViewAllInfo) => ({
	...defaultFields,
	...canViewAllInfo && fullFields,
	...getCustomFields(canViewAllInfo),
});

const removePasswordInfo = (user) => {
	if (user && user.services) {
		delete user.services.password;
		delete user.services.email;
		delete user.services.resume;
		delete user.services.emailCode;
		delete user.services.cloud;
		delete user.services.email2fa;
		delete user.services.totp;
	}
	return user;
};

export function getFullUserDataByIdOrUsername({ userId, filterId, filterUsername }) {
	const caller = Users.findOneById(userId, { fields: { username: 1 } });
	const myself = userId === filterId || filterUsername === caller.username;
	const canViewAllInfo = myself || hasPermission(userId, 'view-full-other-user-info');

	const fields = getFields(canViewAllInfo);

	const options = {
		fields,
	};
	const user = Users.findOneByIdOrUsername(filterId || filterUsername, options);

	return myself ? user : removePasswordInfo(user);
}

export const getFullUserData = function({ userId, filter, limit: l }) {
	const username = s.trim(filter);
	const userToRetrieveFullUserData = username && Users.findOneByUsername(username, { fields: { username: 1 } });
	if (!userToRetrieveFullUserData) {
		return;
	}

	const isMyOwnInfo = userToRetrieveFullUserData && userToRetrieveFullUserData._id === userId;
	const viewFullOtherUserInfo = hasPermission(userId, 'view-full-other-user-info');

	const canViewAllInfo = isMyOwnInfo || viewFullOtherUserInfo;

	const limit = !viewFullOtherUserInfo ? 1 : l;

	if (!username && limit <= 1) {
		return undefined;
	}

	const fields = getFields(canViewAllInfo);

	const options = {
		fields,
		limit,
		sort: { username: 1 },
	};

	if (!username) {
		return Users.find({}, options);
	}

	if (limit === 1) {
		return Users.findByUsername(userToRetrieveFullUserData.username, options);
	}

	const usernameReg = new RegExp(s.escapeRegExp(username), 'i');
	return Users.findByUsernameNameOrEmailAddress(usernameReg, options);
};
