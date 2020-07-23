import { ServerResponse } from 'http';

import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { Accounts } from 'meteor/accounts-base';
import { TAPi18n } from 'meteor/rocketchat:tap-i18n';
import fiber from 'fibers';
import s from 'underscore.string';

import { settings } from '../../../settings/server';
import { Users, Rooms, CredentialTokens } from '../../../models/server';
import { IUser } from '../../../../definition/IUser';
import { IIncomingMessage } from '../../../../definition/IIncomingMessage';
import { _setUsername, createRoom, generateUsernameSuggestion, addUserToRoom } from '../../../lib/server/functions';
import { SAMLServiceProvider } from './ServiceProvider';
import { IServiceProviderOptions } from '../definition/IServiceProviderOptions';
import { ISAMLAction } from '../definition/ISAMLAction';
import { ISAMLUser } from '../definition/ISAMLUser';
import { SAMLUtils } from './Utils';

const showErrorMessage = function(res: ServerResponse, err: string): void {
	res.writeHead(200, {
		'Content-Type': 'text/html',
	});
	const content = `<html><body><h2>Sorry, an annoying error occured</h2><div>${ s.escapeHTML(err) }</div></body></html>`;
	res.end(content, 'utf-8');
};

export class SAML {
	public static processRequest(req: IIncomingMessage, res: ServerResponse, service: IServiceProviderOptions, samlObject: ISAMLAction): void {
		// Skip everything if there's no service set by the saml middleware
		if (!service) {
			if (samlObject.actionName === 'metadata') {
				showErrorMessage(res, `Unexpected SAML service ${ samlObject.serviceName }`);
				return;
			}

			throw new Error(`Unexpected SAML service ${ samlObject.serviceName }`);
		}

		switch (samlObject.actionName) {
			case 'metadata':
				return this.processMetadataAction(res, service);
			case 'logout':
				return this.processLogoutAction(req, res, service);
			case 'sloRedirect':
				return this.processSLORedirectAction(req, res);
			case 'authorize':
				return this.processAuthorizeAction(res, service, samlObject);
			case 'validate':
				return this.processValidateAction(req, res, service, samlObject);
			default:
				throw new Error(`Unexpected SAML action ${ samlObject.actionName }`);
		}
	}

	public static hasCredential(credentialToken: string): boolean {
		return CredentialTokens.findOneById(credentialToken) != null;
	}

	public static retrieveCredential(credentialToken: string): Record<string, any> | undefined {
		// The credentialToken in all these functions corresponds to SAMLs inResponseTo field and is mandatory to check.
		const data = CredentialTokens.findOneById(credentialToken);
		if (data) {
			return data.userInfo;
		}
	}

	public static storeCredential(credentialToken: string, loginResult: object): void {
		CredentialTokens.create(credentialToken, loginResult);
	}

	public static insertOrUpdateSAMLUser(userObject: ISAMLUser): {userId: string; token: string} {
		// @ts-ignore RegExp.escape is a meteor method
		const escapeRegexp = (email: string): string => RegExp.escape(email);
		const { roleAttributeSync, generateUsername, immutableProperty, nameOverwrite, mailOverwrite } = SAMLUtils.globalSettings;

		let customIdentifierMatch = false;
		let customIdentifierAttributeName: string | null = null;
		let user = null;

		// First, try searching by custom identifier
		if (userObject.identifier.type === 'custom' && userObject.identifier.attribute && userObject.attributeList.has(userObject.identifier.attribute)) {
			customIdentifierAttributeName = userObject.identifier.attribute;

			const query: Record<string, any> = {};
			query[`services.saml.${ customIdentifierAttributeName }`] = userObject.attributeList.get(customIdentifierAttributeName);
			user = Users.findOne(query);

			if (user) {
				customIdentifierMatch = true;
			}
		}

		// Second, try searching by username or email (according to the immutableProperty setting)
		if (!user) {
			const expression = userObject.emailList.map((email) => `^${ escapeRegexp(email) }$`).join('|');
			const emailRegex = new RegExp(expression, 'i');

			user = SAML.findUser(userObject.username, emailRegex);
		}

		const emails = userObject.emailList.map((email) => ({
			address: email,
			verified: settings.get('Accounts_Verify_Email_For_External_Accounts'),
		}));
		const globalRoles = userObject.roles;

		let { username } = userObject;

		if (!user) {
			const newUser: Record<string, any> = {
				name: userObject.fullName,
				active: true,
				globalRoles,
				emails,
				services: {
					saml: {
						provider: userObject.samlLogin.provider,
						idp: userObject.samlLogin.idp,
					},
				},
			};

			if (customIdentifierAttributeName) {
				newUser.services.saml[customIdentifierAttributeName] = userObject.attributeList.get(customIdentifierAttributeName);
			}

			if (generateUsername === true) {
				username = generateUsernameSuggestion(newUser);
			}

			if (username) {
				newUser.username = username;
				newUser.name = newUser.name || SAML.guessNameFromUsername(username);
			}

			if (userObject.language) {
				const languages = TAPi18n.getLanguages();
				if (languages[userObject.language]) {
					newUser.language = userObject.language;
				}
			}

			const userId = Accounts.insertUserDoc({}, newUser);
			user = Users.findOne(userId);

			if (userObject.channels) {
				SAML.subscribeToSAMLChannels(userObject.channels, user);
			}
		}

		// creating the token and adding to the user
		const stampedToken = Accounts._generateStampedLoginToken();
		Users.addPersonalAccessTokenToUser({
			userId: user._id,
			loginTokenObject: stampedToken,
		});

		const updateData: Record<string, any> = {
			'services.saml.provider': userObject.samlLogin.provider,
			'services.saml.idp': userObject.samlLogin.idp,
			'services.saml.idpSession': userObject.samlLogin.idpSession,
			'services.saml.nameID': userObject.samlLogin.nameID,
		};

		// If the user was not found through the customIdentifier property, then update it's value
		if (customIdentifierMatch === false && customIdentifierAttributeName) {
			updateData[`services.saml.${ customIdentifierAttributeName }`] = userObject.attributeList.get(customIdentifierAttributeName);
		}

		for (const [customField, value] of userObject.customFields) {
			updateData[`customFields.${ customField }`] = value;
		}

		// Overwrite mail if needed
		if (mailOverwrite === true && (customIdentifierMatch === true || immutableProperty !== 'EMail')) {
			updateData.emails = emails;
		}

		// Overwrite fullname if needed
		if (nameOverwrite === true) {
			updateData.name = userObject.fullName;
		}

		if (roleAttributeSync) {
			updateData.roles = globalRoles;
		}

		Users.update({
			_id: user._id,
		}, {
			$set: updateData,
		});

		if (username && username !== user.username) {
			_setUsername(user._id, username);
		}

		// sending token along with the userId
		return {
			userId: user._id,
			token: stampedToken.token,
		};
	}

	private static processMetadataAction(res: ServerResponse, service: IServiceProviderOptions): void {
		try {
			const serviceProvider = new SAMLServiceProvider(service);

			res.writeHead(200);
			res.write(serviceProvider.generateServiceProviderMetadata());
			res.end();
		} catch (err) {
			showErrorMessage(res, err);
		}
	}

	private static processLogoutAction(req: IIncomingMessage, res: ServerResponse, service: IServiceProviderOptions): void {
		// This is where we receive SAML LogoutResponse
		if (req.query.SAMLRequest) {
			return this.processLogoutRequest(req, res, service);
		}

		return this.processLogoutResponse(req, res, service);
	}

	private static _logoutRemoveTokens(userId: string): void {
		SAMLUtils.log(`Found user ${ userId }`);

		Users.unsetLoginTokens(userId);
		Users.removeSamlServiceSession(userId);
	}

	private static processLogoutRequest(req: IIncomingMessage, res: ServerResponse, service: IServiceProviderOptions): void {
		const serviceProvider = new SAMLServiceProvider(service);
		serviceProvider.validateLogoutRequest(req.query.SAMLRequest, (err, result) => {
			if (err) {
				console.error(err);
				throw new Meteor.Error('Unable to Validate Logout Request');
			}

			if (!result) {
				throw new Meteor.Error('Unable to process Logout Request: missing request data.');
			}

			let timeoutHandler: NodeJS.Timer | null = null;
			const redirect = (url?: string | undefined): void => {
				if (!timeoutHandler) {
					// If the handler is null, then we already ended the response;
					return;
				}

				clearTimeout(timeoutHandler);
				timeoutHandler = null;

				res.writeHead(302, {
					Location: url || Meteor.absoluteUrl(),
				});
				res.end();
			};

			// Add a timeout to end the server response
			timeoutHandler = setTimeout(() => {
				// If we couldn't get a valid IdP url, let's redirect the user to our home so the browser doesn't hang on them.
				redirect();
			}, 5000);

			fiber(() => {
				try {
					const cursor = Users.findBySAMLNameIdOrIdpSession(result.nameID, result.idpSession);
					const count = cursor.count();
					if (count > 1) {
						throw new Meteor.Error('Found multiple users matching SAML session');
					}

					if (count === 0) {
						throw new Meteor.Error('Invalid logout request: no user associated with session.');
					}

					const loggedOutUser = cursor.fetch();
					this._logoutRemoveTokens(loggedOutUser[0]._id);

					const { response } = serviceProvider.generateLogoutResponse({
						nameID: result.nameID || '',
						sessionIndex: result.idpSession || '',
						inResponseToId: result.id || '',
					});

					serviceProvider.logoutResponseToUrl(response, (err, url) => {
						if (err) {
							console.error(err);
							return redirect();
						}

						redirect(url);
					});
				} catch (e) {
					console.error(e);
					redirect();
				}
			}).run();
		});
	}

	private static processLogoutResponse(req: IIncomingMessage, res: ServerResponse, service: IServiceProviderOptions): void {
		if (!req.query.SAMLResponse) {
			SAMLUtils.error('Invalid LogoutResponse, missing SAMLResponse', req.query);
			throw new Error('Invalid LogoutResponse received.');
		}

		const serviceProvider = new SAMLServiceProvider(service);
		serviceProvider.validateLogoutResponse(req.query.SAMLResponse, (err, inResponseTo) => {
			if (err) {
				return;
			}

			if (!inResponseTo) {
				throw new Meteor.Error('Invalid logout request: no inResponseTo value.');
			}

			const logOutUser = (inResponseTo: string): void => {
				SAMLUtils.log(`Logging Out user via inResponseTo ${ inResponseTo }`);

				const cursor = Users.findBySAMLInResponseTo(inResponseTo);
				const count = cursor.count();
				if (count > 1) {
					throw new Meteor.Error('Found multiple users matching SAML inResponseTo fields');
				}

				if (count === 0) {
					throw new Meteor.Error('Invalid logout request: no user associated with inResponseTo.');
				}

				const loggedOutUser = cursor.fetch();
				this._logoutRemoveTokens(loggedOutUser[0]._id);
			};

			try {
				fiber(() => logOutUser(inResponseTo)).run();
			} finally {
				res.writeHead(302, {
					Location: req.query.RelayState,
				});
				res.end();
			}
		});
	}

	private static processSLORedirectAction(req: IIncomingMessage, res: ServerResponse): void {
		res.writeHead(302, {
			// credentialToken here is the SAML LogOut Request that we'll send back to IDP
			Location: req.query.redirect,
		});
		res.end();
	}

	private static processAuthorizeAction(res: ServerResponse, service: IServiceProviderOptions, samlObject: ISAMLAction): void {
		service.id = samlObject.credentialToken;

		const serviceProvider = new SAMLServiceProvider(service);
		serviceProvider.getAuthorizeUrl((err, url) => {
			if (err) {
				SAMLUtils.error('Unable to generate authorize url');
				SAMLUtils.error(err);
				url = Meteor.absoluteUrl();
			}

			res.writeHead(302, {
				Location: url,
			});
			res.end();
		});
	}

	private static processValidateAction(req: IIncomingMessage, res: ServerResponse, service: IServiceProviderOptions, samlObject: ISAMLAction): void {
		const serviceProvider = new SAMLServiceProvider(service);
		SAMLUtils.relayState = req.body.RelayState;
		serviceProvider.validateResponse(req.body.SAMLResponse, (err, profile/* , loggedOut*/) => {
			try {
				if (err) {
					SAMLUtils.error(err);
					throw new Error('Unable to validate response url');
				}

				if (!profile) {
					throw new Error('No user data collected from IdP response.');
				}

				let credentialToken = (profile.inResponseToId && profile.inResponseToId.value) || profile.inResponseToId || profile.InResponseTo || samlObject.credentialToken;
				const loginResult = {
					profile,
				};

				if (!credentialToken) {
					// If the login was initiated by the IDP, then we don't have a credentialToken as there was no AuthorizeRequest on our side
					// so we create a random token now to use the same url to end the login
					//
					// to test an IdP initiated login on localhost, use the following URL (assuming SimpleSAMLPHP on localhost:8080):
					// http://localhost:8080/simplesaml/saml2/idp/SSOService.php?spentityid=http://localhost:3000/_saml/metadata/test-sp
					credentialToken = Random.id();
					SAMLUtils.log('[SAML] Using random credentialToken: ', credentialToken);
				}

				this.storeCredential(credentialToken, loginResult);
				const url = `${ Meteor.absoluteUrl('home') }?saml_idp_credentialToken=${ credentialToken }`;
				res.writeHead(302, {
					Location: url,
				});
				res.end();
			} catch (error) {
				SAMLUtils.error(error);
				res.writeHead(302, {
					Location: Meteor.absoluteUrl(),
				});
				res.end();
			}
		});
	}

	private static findUser(username: string | undefined, emailRegex: RegExp): IUser | undefined {
		const { globalSettings } = SAMLUtils;

		if (globalSettings.immutableProperty === 'Username') {
			if (username) {
				return Users.findOne({
					username,
				});
			}

			return;
		}

		return Users.findOne({
			'emails.address': emailRegex,
		});
	}

	private static guessNameFromUsername(username: string): string {
		return username
			.replace(/\W/g, ' ')
			.replace(/\s(.)/g, (u) => u.toUpperCase())
			.replace(/^(.)/, (u) => u.toLowerCase())
			.replace(/^\w/, (u) => u.toUpperCase());
	}

	private static subscribeToSAMLChannels(channels: Array<string>, user: IUser): void {
		try {
			for (let roomName of channels) {
				roomName = roomName.trim();
				if (!roomName) {
					continue;
				}

				const room = Rooms.findOneByNameAndType(roomName, 'c', {});
				if (!room) {
					// If the user doesn't have an username yet, we can't create new rooms for them
					if (user.username) {
						createRoom('c', roomName, user.username);
					}
					continue;
				}

				addUserToRoom(room._id, user);
			}
		} catch (err) {
			console.error(err);
		}
	}
}
