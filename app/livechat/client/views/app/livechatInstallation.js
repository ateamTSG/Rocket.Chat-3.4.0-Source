import { Template } from 'meteor/templating';
import s from 'underscore.string';

import { settings } from '../../../../settings';
import './livechatInstallation.html';

Template.livechatInstallation.helpers({
	script() {
		const siteUrl = s.rtrim(settings.get('Site_Url'), '/');
		return `<!-- Start of Rocket.Chat Livechat Script -->
<script type="text/javascript">
(function(w, d, s, u) {
	w.RocketChat = function(c) { w.RocketChat._.push(c) }; w.RocketChat._ = []; w.RocketChat.url = u;
	var h = d.getElementsByTagName(s)[0], j = d.createElement(s);
	j.async = true; j.src = '${ siteUrl }/livechat/rocketchat-livechat.min.js?_=201903270000';
	h.parentNode.insertBefore(j, h);
})(window, document, 'script', '${ siteUrl }/livechat');
</script>
<!-- End of Rocket.Chat Livechat Script -->`;
	},
});
