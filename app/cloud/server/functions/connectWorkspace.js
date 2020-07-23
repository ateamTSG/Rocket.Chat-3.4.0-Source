import { HTTP } from 'meteor/http';


import { getRedirectUri } from './getRedirectUri';
import { retrieveRegistrationStatus } from './retrieveRegistrationStatus';
import { getWorkspaceAccessToken } from './getWorkspaceAccessToken';
import { Settings } from '../../../models';
import { settings } from '../../../settings';
import { saveRegistrationData } from './saveRegistrationData';

export function connectWorkspace(token) {
	const { connectToCloud } = retrieveRegistrationStatus();
	if (!connectToCloud) {
		Settings.updateValueById('Register_Server', true);
	}

	const redirectUri = getRedirectUri();

	const regInfo = {
		email: settings.get('Organization_Email'),
		client_name: settings.get('Site_Name'),
		redirect_uris: [redirectUri],
	};

	const cloudUrl = settings.get('Cloud_Url');
	let result;
	try {
		result = HTTP.post(`${ cloudUrl }/api/oauth/clients`, {
			headers: {
				Authorization: `Bearer ${ token }`,
			},
			data: regInfo,
		});
	} catch (e) {
		if (e.response && e.response.data && e.response.data.error) {
			console.error(`Failed to register with Rocket.Chat Cloud.  Error: ${ e.response.data.error }`);
		} else {
			console.error(e);
		}

		return false;
	}

	const { data } = result;

	if (!data) {
		return false;
	}

	Promise.await(saveRegistrationData(data));

	// Now that we have the client id and secret, let's get the access token
	const accessToken = getWorkspaceAccessToken(true);
	if (!accessToken) {
		return false;
	}

	return true;
}
