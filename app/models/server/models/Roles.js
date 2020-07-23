import { Base } from './_Base';

import * as Models from '..';


export class Roles extends Base {
	constructor(...args) {
		super(...args);
		this.tryEnsureIndex({ name: 1 });
		this.tryEnsureIndex({ scope: 1 });
	}

	findUsersInRole(name, scope, options) {
		const role = this.findOne(name);
		const roleScope = (role && role.scope) || 'Users';
		const model = Models[roleScope];

		return model && model.findUsersInRoles && model.findUsersInRoles(name, scope, options);
	}

	isUserInRoles(userId, roles, scope) {
		roles = [].concat(roles);
		return roles.some((roleName) => {
			const role = this.findOne(roleName);
			const roleScope = (role && role.scope) || 'Users';
			const model = Models[roleScope];

			return model && model.isUserInRole && model.isUserInRole(userId, roleName, scope);
		});
	}

	createOrUpdate(name, scope = 'Users', description = '', protectedRole = true, mandatory2fa = false) {
		const queryData = {
			name,
			scope,
			protected: protectedRole,
		};

		const updateData = {
			...queryData,
			description,
			mandatory2fa,
		};

		const exists = this.findOne({
			_id: name,
			...queryData,
		}, { fields: { _id: 1 } });

		if (exists) {
			return exists._id;
		}

		this.upsert({ _id: name }, { $set: updateData });
	}

	addUserRoles(userId, roles, scope) {
		roles = [].concat(roles);
		for (const roleName of roles) {
			const role = this.findOne(roleName);
			const roleScope = (role && role.scope) || 'Users';
			const model = Models[roleScope];

			model && model.addRolesByUserId && model.addRolesByUserId(userId, roleName, scope);
		}
		return true;
	}

	removeUserRoles(userId, roles, scope) {
		roles = [].concat(roles);
		for (const roleName of roles) {
			const role = this.findOne(roleName);
			const roleScope = (role && role.scope) || 'Users';
			const model = Models[roleScope];

			model && model.removeRolesByUserId && model.removeRolesByUserId(userId, roleName, scope);
		}
		return true;
	}

	findOneByIdOrName(_idOrName, options) {
		const query = {
			$or: [{
				_id: _idOrName,
			}, {
				name: _idOrName,
			}],
		};

		return this.findOne(query, options);
	}

	findByUpdatedDate(updatedAfterDate, options) {
		const query = {
			_updatedAt: { $gte: new Date(updatedAfterDate) },
		};

		return this.find(query, options);
	}

	canAddUserToRole(uid, roleName, scope) {
		const role = this.findOne({ _id: roleName }, { fields: { scope: 1 } });
		if (!role) {
			return false;
		}

		const model = Models[role.scope];
		if (!model) {
			return;
		}

		const user = model.isUserInRoleScope(uid, scope);
		return !!user;
	}
}

export default new Roles('roles');
