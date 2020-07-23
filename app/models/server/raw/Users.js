import { BaseRaw } from './BaseRaw';

export class UsersRaw extends BaseRaw {
	findUsersInRoles(roles, scope, options) {
		roles = [].concat(roles);

		const query = {
			roles: { $in: roles },
		};

		return this.find(query, options);
	}

	findOneByUsername(username, options = null) {
		const query = { username };

		return this.findOne(query, options);
	}

	findUsersInRolesWithQuery(roles, query, options) {
		roles = [].concat(roles);

		Object.assign(query, { roles: { $in: roles } });

		return this.find(query, options);
	}

	isUserInRole(userId, roleName) {
		const query = {
			_id: userId,
			roles: roleName,
		};

		return this.findOne(query, { fields: { roles: 1 } });
	}

	getDistinctFederationDomains() {
		return this.col.distinct('federation.origin', { federation: { $exists: true } });
	}

	async getNextLeastBusyAgent(department) {
		const aggregate = [
			{ $match: { status: { $exists: true, $ne: 'offline' }, statusLivechat: 'available', roles: 'livechat-agent' } },
			{ $lookup: { from: 'view_livechat_queue_status', localField: '_id', foreignField: '_id', as: 'LivechatQueueStatus' } }, // the `view_livechat_queue_status` it's a view created when the server starts
			{ $lookup: { from: 'rocketchat_livechat_department_agents', localField: '_id', foreignField: 'agentId', as: 'departments' } },
			{ $project: { agentId: '$_id', username: 1, lastRoutingTime: 1, departments: 1, queueInfo: { $arrayElemAt: ['$LivechatQueueStatus', 0] } } },
			{ $sort: { 'queueInfo.chats': 1, lastRoutingTime: 1, username: 1 } },
		];

		if (department) {
			aggregate.push({ $unwind: '$departments' });
			aggregate.push({ $match: { 'departments.departmentId': department } });
		}

		aggregate.push({ $limit: 1 });

		const [agent] = await this.col.aggregate(aggregate).toArray();
		if (agent) {
			await this.setLastRoutingTime(agent.agentId);
		}

		return agent;
	}

	setLastRoutingTime(userId) {
		const query = {
			_id: userId,
		};

		const update = {
			$set: {
				lastRoutingTime: new Date(),
			},
		};

		return this.col.updateOne(query, update);
	}

	async getAgentAndAmountOngoingChats(userId) {
		const aggregate = [
			{ $match: { _id: userId, status: { $exists: true, $ne: 'offline' }, statusLivechat: 'available', roles: 'livechat-agent' } },
			{ $lookup: { from: 'view_livechat_queue_status', localField: '_id', foreignField: '_id', as: 'LivechatQueueStatus' } },
			{ $project: { username: 1, queueInfo: { $arrayElemAt: ['$LivechatQueueStatus', 0] } } },
		];

		const [agent] = await this.col.aggregate(aggregate).toArray();
		return agent;
	}

	findAllResumeTokensByUserId(userId) {
		return this.col.aggregate([
			{
				$match: {
					_id: userId,
				},
			},
			{
				$project: {
					tokens: {
						$filter: {
							input: '$services.resume.loginTokens',
							as: 'token',
							cond: {
								$ne: ['$$token.type', 'personalAccessToken'],
							},
						},
					},
				},
			},
			{ $unwind: '$tokens' },
			{ $sort: { 'tokens.when': 1 } },
			{ $group: { _id: '$_id', tokens: { $push: '$tokens' } } },
		]).toArray();
	}

	findActiveByUsernameOrNameRegexWithExceptionsAndConditions(termRegex, exceptions, conditions, options) {
		if (exceptions == null) { exceptions = []; }
		if (conditions == null) { conditions = {}; }
		if (options == null) { options = {}; }
		if (!Array.isArray(exceptions)) {
			exceptions = [exceptions];
		}

		const query = {
			$or: [{
				username: termRegex,
			}, {
				name: termRegex,
			}],
			active: true,
			type: {
				$in: ['user', 'bot'],
			},
			$and: [{
				username: {
					$exists: true,
				},
			}, {
				username: {
					$nin: exceptions,
				},
			}],
			...conditions,
		};

		return this.find(query, options);
	}

	countAllAgentsStatus({ departmentId = undefined }) {
		const match = {
			$match: {
				roles: { $in: ['livechat-agent'] },
			},
		};
		const group = {
			$group: {
				_id: null,
				offline: {
					$sum: {
						$cond: [{
							$or: [{
								$and: [
									{ $eq: ['$status', 'offline'] },
									{ $eq: ['$statusLivechat', 'available'] },
								],
							},
							{ $eq: ['$statusLivechat', 'not-available'] },
							],
						}, 1, 0],
					},
				},
				away: {
					$sum: {
						$cond: [{
							$and: [
								{ $eq: ['$status', 'away'] },
								{ $eq: ['$statusLivechat', 'available'] },
							],
						}, 1, 0],
					},
				},
				busy: {
					$sum: {
						$cond: [{
							$and: [
								{ $eq: ['$status', 'busy'] },
								{ $eq: ['$statusLivechat', 'available'] },
							],
						}, 1, 0],
					},
				},
				available: {
					$sum: {
						$cond: [{
							$and: [
								{ $eq: ['$status', 'online'] },
								{ $eq: ['$statusLivechat', 'available'] },
							],
						}, 1, 0],
					},
				},
			},
		};
		const lookup = {
			$lookup: {
				from: 'rocketchat_livechat_department_agents',
				localField: '_id',
				foreignField: 'agentId',
				as: 'departments',
			},
		};
		const unwind = {
			$unwind: {
				path: '$departments',
				preserveNullAndEmptyArrays: true,
			},
		};
		const departmentsMatch = {
			$match: {
				'departments.departmentId': departmentId,
			},
		};
		const params = [match];
		if (departmentId && departmentId !== 'undefined') {
			params.push(lookup);
			params.push(unwind);
			params.push(departmentsMatch);
		}
		params.push(group);
		return this.col.aggregate(params).toArray();
	}

	getTotalOfRegisteredUsersByDate({ start, end, options = {} }) {
		const params = [
			{
				$match: {
					createdAt: { $gte: start, $lte: end },
				},
			},
			{
				$group: {
					_id: {
						$concat: [
							{ $substr: ['$createdAt', 0, 4] },
							{ $substr: ['$createdAt', 5, 2] },
							{ $substr: ['$createdAt', 8, 2] },
						],
					},
					users: { $sum: 1 },
				},
			},
			{
				$group: {
					_id: {
						$toInt: '$_id',
					},
					users: { $sum: '$users' },
				},
			},
			{
				$project: {
					_id: 0,
					date: '$_id',
					users: 1,
					type: 'users',
				},
			},
		];
		if (options.sort) {
			params.push({ $sort: options.sort });
		}
		if (options.count) {
			params.push({ $limit: options.count });
		}
		return this.col.aggregate(params).toArray();
	}

	updateStatusText(_id, statusText) {
		const update = {
			$set: {
				statusText,
			},
		};

		return this.update({ _id }, update);
	}

	updateStatusByAppId(appId, status) {
		const query = {
			appId,
			status: { $ne: status },
		};

		const update = {
			$set: {
				status,
			},
		};

		return this.update(query, update, { multi: true });
	}

	openAgentsBusinessHoursByBusinessHourId(businessHourIds) {
		const query = {
			roles: 'livechat-agent',
		};

		const update = {
			$set: {
				statusLivechat: 'available',
			},
			$addToSet: {
				openBusinessHours: { $each: businessHourIds },
			},
		};

		return this.update(query, update, { multi: true });
	}

	addBusinessHourByAgentIds(agentIds = [], businessHourId) {
		const query = {
			_id: { $in: agentIds },
			roles: 'livechat-agent',
		};

		const update = {
			$set: {
				statusLivechat: 'available',
			},
			$addToSet: {
				openBusinessHours: businessHourId,
			},
		};

		return this.update(query, update, { multi: true });
	}

	removeBusinessHourByAgentIds(agentIds = [], businessHourId) {
		const query = {
			_id: { $in: agentIds },
			roles: 'livechat-agent',
		};

		const update = {
			$pull: {
				openBusinessHours: businessHourId,
			},
		};

		return this.update(query, update, { multi: true });
	}

	openBusinessHourToAgentsWithoutDepartment(agentIdsWithDepartment = [], businessHourId) {
		const query = {
			_id: { $nin: agentIdsWithDepartment },
		};

		const update = {
			$set: {
				statusLivechat: 'available',
			},
			$addToSet: {
				openBusinessHours: businessHourId,
			},
		};

		return this.update(query, update, { multi: true });
	}

	closeBusinessHourToAgentsWithoutDepartment(agentIdsWithDepartment = [], businessHourId) {
		const query = {
			_id: { $nin: agentIdsWithDepartment },
		};

		const update = {
			$pull: {
				openBusinessHours: businessHourId,
			},
		};

		return this.update(query, update, { multi: true });
	}

	closeAgentsBusinessHoursByBusinessHourIds(businessHourIds) {
		const query = {
			roles: 'livechat-agent',
		};

		const update = {
			$pull: {
				openBusinessHours: { $in: businessHourIds },
			},
		};

		return this.update(query, update, { multi: true });
	}

	updateLivechatStatusBasedOnBusinessHours(userIds = []) {
		const query = {
			$or: [{ openBusinessHours: { $exists: false } }, { openBusinessHours: { $size: 0 } }],
			roles: 'livechat-agent',
			...Array.isArray(userIds) && userIds.length > 0 && { _id: { $in: userIds } },
		};

		const update = {
			$set: {
				statusLivechat: 'not-available',
			},
		};

		return this.update(query, update, { multi: true });
	}

	async isAgentWithinBusinessHours(agentId) {
		return await this.find({
			_id: agentId,
			openBusinessHours: {
				$exists: true,
				$not: { $size: 0 },
			},
		}).count() > 0;
	}

	removeBusinessHoursFromAllUsers() {
		const query = {
			roles: 'livechat-agent',
			openBusinessHours: {
				$exists: true,
			},
		};

		const update = {
			$unset: {
				openBusinessHours: 1,
			},
		};

		return this.update(query, update, { multi: true });
	}
}
