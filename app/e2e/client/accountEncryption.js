import { Template } from 'meteor/templating';
import { Meteor } from 'meteor/meteor';
import { ReactiveVar } from 'meteor/reactive-var';
import toastr from 'toastr';
import s from 'underscore.string';

import { e2e } from './rocketchat.e2e';
import { settings } from '../../settings';
import { t } from '../../utils';

Template.accountEncryption.helpers({
	isEnabled() {
		return settings.get('E2E_Enable');
	},
	allowKeyChange() {
		return Meteor._localStorage.getItem('public_key') && Meteor._localStorage.getItem('private_key');
	},
	canConfirmNewKey() {
		const encryptionKey = Template.instance().encryptionKey.get();
		return encryptionKey && encryptionKey !== '';
	},
	ifThenElse(condition, val, not = '') {
		return condition ? val : not;
	},
	canSave(ret) {
		const instance = Template.instance();

		const encryptionKey = instance.encryptionKey.get();
		const confirmationEncryptionKey = instance.confirmationEncryptionKey.get();

		if (!encryptionKey || encryptionKey !== confirmationEncryptionKey) {
			return ret;
		}
	},
});

Template.accountEncryption.events({
	'input [name=encryptionKey]'(e, instance) {
		instance.encryptionKey.set(e.target.value);

		if (e.target.value.length === 0) {
			instance.confirmationEncryptionKey.set('');
		}
	},
	'input [name=confirmation-encryptionKey]'(e, instance) {
		instance.confirmationEncryptionKey.set(e.target.value);
	},
	'click button[name=reset-e2e-key]'(e, instance) {
		e.preventDefault();

		return instance.resetKey();
	},
	'submit form'(e, instance) {
		e.preventDefault();

		return instance.save();
	},
});

Template.accountEncryption.onCreated(function() {
	const self = this;

	this.encryptionKey = new ReactiveVar();
	this.confirmationEncryptionKey = new ReactiveVar();

	this.save = function(cb) {
		const instance = this;
		const data = {};

		if (s.trim(self.encryptionKey.get())) {
			data.newEncryptionKey = self.encryptionKey.get();
		}

		if (Object.keys(data).length === 0) {
			return cb && cb();
		}

		e2e.changePassword(data.newEncryptionKey);

		instance.clearForm();
		toastr.remove();
		this.encryptionKey.set('');
		this.confirmationEncryptionKey.set('');

		toastr.success(t('Encryption_key_saved_successfully'));
	};

	this.clearForm = function() {
		this.find('[name=encryptionKey]').value = '';
		this.find('[name=confirmation-encryptionKey]').value = '';
	};

	this.resetKey = function() {
		Meteor.call('e2e.resetOwnE2EKey', (error, result) => {
			if (result) {
				toastr.success(t('User_e2e_key_was_reset'));
			}
		});
	};
});
