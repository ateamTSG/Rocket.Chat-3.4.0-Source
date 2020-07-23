import limax from 'limax';
import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import _ from 'underscore';
import moment from 'moment';

import {
	RawImports,
	Base,
	ProgressStep,
	Selection,
	SelectionChannel,
	SelectionUser,
} from '../../importer/server';
import { RocketChatFile } from '../../file';
import { Users, Rooms } from '../../models';
import { sendMessage } from '../../lib';

import 'moment-timezone';

export class HipChatImporter extends Base {
	constructor(info, importRecord) {
		super(info, importRecord);

		this.userTags = [];
		this.roomPrefix = 'hipchat_export/rooms/';
		this.usersPrefix = 'hipchat_export/users/';
	}

	prepare(dataURI, sentContentType, fileName, skipTypeCheck) {
		super.prepare(dataURI, sentContentType, fileName, skipTypeCheck);
		const { image } = RocketChatFile.dataURIParse(dataURI);
		// const contentType = ref.contentType;
		const zip = new this.AdmZip(new Buffer(image, 'base64'));
		const zipEntries = zip.getEntries();
		let tempRooms = [];
		let tempUsers = [];
		const tempMessages = {};

		zipEntries.forEach((entry) => {
			if (entry.entryName.indexOf('__MACOSX') > -1) {
				this.logger.debug(`Ignoring the file: ${ entry.entryName }`);
			}
			if (entry.isDirectory) {
				return;
			}
			if (entry.entryName.indexOf(this.roomPrefix) > -1) {
				let roomName = entry.entryName.split(this.roomPrefix)[1];
				if (roomName === 'list.json') {
					super.updateProgress(ProgressStep.PREPARING_CHANNELS);
					tempRooms = JSON.parse(entry.getData().toString()).rooms;
					tempRooms.forEach((room) => {
						room.name = limax(room.name);
					});
				} else if (roomName.indexOf('/') > -1) {
					const item = roomName.split('/');
					roomName = limax(item[0]);
					const msgGroupData = item[1].split('.')[0];
					if (!tempMessages[roomName]) {
						tempMessages[roomName] = {};
					}
					try {
						tempMessages[roomName][msgGroupData] = JSON.parse(entry.getData().toString());
						return tempMessages[roomName][msgGroupData];
					} catch (error) {
						return this.logger.warn(`${ entry.entryName } is not a valid JSON file! Unable to import it.`);
					}
				}
			} else if (entry.entryName.indexOf(this.usersPrefix) > -1) {
				const usersName = entry.entryName.split(this.usersPrefix)[1];
				if (usersName === 'list.json') {
					super.updateProgress(ProgressStep.PREPARING_USERS);
					tempUsers = JSON.parse(entry.getData().toString()).users;
					return tempUsers;
				}
				return this.logger.warn(`Unexpected file in the ${ this.name } import: ${ entry.entryName }`);
			}
		});
		const usersId = this.collection.insert({
			import: this.importRecord._id,
			importer: this.name,
			type: 'users',
			users: tempUsers,
		});
		this.users = this.collection.findOne(usersId);
		this.updateRecord({
			'count.users': tempUsers.length,
		});
		this.addCountToTotal(tempUsers.length);
		const channelsId = this.collection.insert({
			import: this.importRecord._id,
			importer: this.name,
			type: 'channels',
			channels: tempRooms,
		});
		this.channels = this.collection.findOne(channelsId);
		this.updateRecord({
			'count.channels': tempRooms.length,
		});
		this.addCountToTotal(tempRooms.length);
		super.updateProgress(ProgressStep.PREPARING_MESSAGES);
		let messagesCount = 0;

		Object.keys(tempMessages).forEach((channel) => {
			const messagesObj = tempMessages[channel];

			Object.keys(messagesObj).forEach((date) => {
				const msgs = messagesObj[date];
				messagesCount += msgs.length;
				this.updateRecord({
					messagesstatus: `${ channel }/${ date }`,
				});

				if (Base.getBSONSize(msgs) > Base.getMaxBSONSize()) {
					Base.getBSONSafeArraysFromAnArray(msgs).forEach((splitMsg, i) => {
						this.collection.insert({
							import: this.importRecord._id,
							importer: this.name,
							type: 'messages',
							name: `${ channel }/${ date }.${ i }`,
							messages: splitMsg,
							channel,
							date,
							i,
						});
					});
				} else {
					this.collection.insert({
						import: this.importRecord._id,
						importer: this.name,
						type: 'messages',
						name: `${ channel }/${ date }`,
						messages: msgs,
						channel,
						date,
					});
				}
			});
		});
		this.updateRecord({
			'count.messages': messagesCount,
			messagesstatus: null,
		});
		this.addCountToTotal(messagesCount);
		if (tempUsers.length === 0 || tempRooms.length === 0 || messagesCount === 0) {
			this.logger.warn(`The loaded users count ${ tempUsers.length }, the loaded channels ${ tempRooms.length }, and the loaded messages ${ messagesCount }`);
			super.updateProgress(ProgressStep.ERROR);
			return this.getProgress();
		}
		const selectionUsers = tempUsers.map(function(user) {
			return new SelectionUser(user.user_id, user.name, user.email, user.is_deleted, false, !user.is_bot);
		});
		const selectionChannels = tempRooms.map(function(room) {
			return new SelectionChannel(room.room_id, room.name, room.is_archived, true, false);
		});
		const selectionMessages = this.importRecord.count.messages;
		super.updateProgress(ProgressStep.USER_SELECTION);
		return new Selection(this.name, selectionUsers, selectionChannels, selectionMessages);
	}

	startImport(importSelection) {
		this.users = RawImports.findOne({ import: this.importRecord._id, type: 'users' });
		this.channels = RawImports.findOne({ import: this.importRecord._id, type: 'channels' });
		this.reloadCount();

		super.startImport(importSelection);
		const start = Date.now();

		importSelection.users.forEach((user) => {
			this.users.users.forEach((u) => {
				if (u.user_id === user.user_id) {
					u.do_import = user.do_import;
				}
			});
		});
		this.collection.update({ _id: this.users._id }, { $set: { users: this.users.users } });

		importSelection.channels.forEach((channel) =>
			this.channels.channels.forEach((c) => {
				if (c.room_id === channel.channel_id) {
					c.do_import = channel.do_import;
				}
			}),
		);
		this.collection.update({ _id: this.channels._id }, { $set: { channels: this.channels.channels } });

		const startedByUserId = Meteor.userId();
		Meteor.defer(() => {
			super.updateProgress(ProgressStep.IMPORTING_USERS);

			try {
				this.users.users.forEach((user) => {
					if (!user.do_import) {
						return;
					}

					Meteor.runAsUser(startedByUserId, () => {
						const existantUser = Users.findOneByEmailAddress(user.email);
						if (existantUser) {
							user.rocketId = existantUser._id;
							this.userTags.push({
								hipchat: `@${ user.mention_name }`,
								rocket: `@${ existantUser.username }`,
							});
						} else {
							const userId = Accounts.createUser({
								email: user.email,
								password: Date.now() + user.name + user.email.toUpperCase(),
							});
							user.rocketId = userId;
							this.userTags.push({
								hipchat: `@${ user.mention_name }`,
								rocket: `@${ user.mention_name }`,
							});
							Meteor.runAsUser(userId, () => {
								Meteor.call('setUsername', user.mention_name, {
									joinDefaultChannelsSilenced: true,
								});
								Meteor.call('setAvatarFromService', user.photo_url, undefined, 'url');
								return Meteor.call('userSetUtcOffset', parseInt(moment().tz(user.timezone).format('Z').toString().split(':')[0]));
							});
							if (user.name != null) {
								Users.setName(userId, user.name);
							}
							if (user.is_deleted) {
								Meteor.call('setUserActiveStatus', userId, false);
							}
						}
						return this.addCountCompleted(1);
					});
				});

				this.collection.update({ _id: this.users._id }, { $set: { users: this.users.users } });

				const channelNames = [];

				super.updateProgress(ProgressStep.IMPORTING_CHANNELS);
				this.channels.channels.forEach((channel) => {
					if (!channel.do_import) {
						return;
					}

					channelNames.push(channel.name);
					Meteor.runAsUser(startedByUserId, () => {
						channel.name = channel.name.replace(/ /g, '');
						const existantRoom = Rooms.findOneByName(channel.name);
						if (existantRoom) {
							channel.rocketId = existantRoom._id;
						} else {
							let userId = '';
							this.users.users.forEach((user) => {
								if (user.user_id === channel.owner_user_id) {
									userId = user.rocketId;
								}
							});
							if (userId === '') {
								this.logger.warn(`Failed to find the channel creator for ${ channel.name }, setting it to the current running user.`);
								userId = startedByUserId;
							}
							Meteor.runAsUser(userId, () => {
								const returned = Meteor.call('createChannel', channel.name, []);
								channel.rocketId = returned.rid;
							});
							Rooms.update({
								_id: channel.rocketId,
							}, {
								$set: {
									ts: new Date(channel.created * 1000),
								},
							});
						}
						return this.addCountCompleted(1);
					});
				});

				this.collection.update({ _id: this.channels._id }, { $set: { channels: this.channels.channels } });

				super.updateProgress(ProgressStep.IMPORTING_MESSAGES);
				const nousers = {};

				for (const channel of channelNames) {
					const hipchatChannel = this.getHipChatChannelFromName(channel);

					if (!hipchatChannel || !hipchatChannel.do_import) {
						continue;
					}

					const room = Rooms.findOneById(hipchatChannel.rocketId, {
						fields: {
							usernames: 1,
							t: 1,
							name: 1,
						},
					});

					const messagePacks = this.collection.find({ import: this.importRecord._id, type: 'messages', channel });

					Meteor.runAsUser(startedByUserId, () => {
						messagePacks.forEach((pack) => {
							const packId = pack.i ? `${ pack.date }.${ pack.i }` : pack.date;

							this.updateRecord({ messagesstatus: `${ channel }/${ packId } (${ pack.messages.length })` });
							pack.messages.forEach((message) => {
								if (message.from != null) {
									const user = this.getRocketUser(message.from.user_id);
									if (user != null) {
										const msgObj = {
											msg: this.convertHipChatMessageToRocketChat(message.message),
											ts: new Date(message.date),
											u: {
												_id: user._id,
												username: user.username,
											},
										};
										sendMessage(user, msgObj, room, true);
									} else if (!nousers[message.from.user_id]) {
										nousers[message.from.user_id] = message.from;
									}
								} else if (!_.isArray(message)) {
									console.warn('Please report the following:', message);
								}

								this.addCountCompleted(1);
							});
						});
					});
				}

				this.logger.warn('The following did not have users:', nousers);
				super.updateProgress(ProgressStep.FINISHING);

				this.channels.channels.forEach((channel) => {
					if (channel.do_import && channel.is_archived) {
						Meteor.runAsUser(startedByUserId, () => Meteor.call('archiveRoom', channel.rocketId));
					}
				});

				super.updateProgress(ProgressStep.DONE);
			} catch (e) {
				this.logger.error(e);
				super.updateProgress(ProgressStep.ERROR);
			}

			const timeTook = Date.now() - start;
			return this.logger.log(`Import took ${ timeTook } milliseconds.`);
		});

		return this.getProgress();
	}

	getHipChatChannelFromName(channelName) {
		return this.channels.channels.find((channel) => channel.name === channelName);
	}

	getRocketUser(hipchatId) {
		const user = this.users.users.find((user) => user.user_id === hipchatId);
		return user ? Users.findOneById(user.rocketId, {
			fields: {
				username: 1,
				name: 1,
			},
		}) : undefined;
	}

	convertHipChatMessageToRocketChat(message) {
		if (message != null) {
			this.userTags.forEach((userReplace) => {
				message = message.replace(userReplace.hipchat, userReplace.rocket);
			});
		} else {
			message = '';
		}
		return message;
	}
}
