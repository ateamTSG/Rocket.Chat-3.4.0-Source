import { Migrations } from '../../../app/migrations/server';
import { Permissions } from '../../../app/models/server';

Migrations.add({
	version: 165,
	up() {
		const manageIntegrationsPermission = Permissions.findOne('manage-integrations');
		const manageOwnIntegrationsPermission = Permissions.findOne('manage-own-integrations');

		if (manageIntegrationsPermission) {
			Permissions.upsert({ _id: 'manage-incoming-integrations' }, { $set: { roles: manageIntegrationsPermission.roles } });
			Permissions.upsert({ _id: 'manage-outgoing-integrations' }, { $set: { roles: manageIntegrationsPermission.roles } });
			Permissions.remove({ _id: 'manage-integrations' });
		}
		if (manageOwnIntegrationsPermission) {
			Permissions.upsert({ _id: 'manage-own-incoming-integrations' }, { $set: { roles: manageOwnIntegrationsPermission.roles } });
			Permissions.upsert({ _id: 'manage-own-outgoing-integrations' }, { $set: { roles: manageOwnIntegrationsPermission.roles } });
			Permissions.remove({ _id: 'manage-own-integrations' });
		}
	},
});
