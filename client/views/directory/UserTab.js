import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Box, Table, Flex, Avatar, TextInput, Icon } from '@rocket.chat/fuselage';
import { useMediaQuery } from '@rocket.chat/fuselage-hooks';

import { GenericTable, Th } from '../../components/GenericTable';
import { useTranslation } from '../../contexts/TranslationContext';
import { useRoute } from '../../contexts/RouterContext';
import { usePermission } from '../../contexts/AuthorizationContext';
import { useQuery } from './hooks';
import { getUserAvatarURL } from '../../../app/utils/client';
import { useEndpointData } from '../../hooks/useEndpointData';
import { useFormatDate } from '../../hooks/useFormatDate';
import NotAuthorizedPage from '../../admin/NotAuthorizedPage';

const style = { whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' };

const FilterByText = ({ setFilter, ...props }) => {
	const t = useTranslation();
	const [text, setText] = useState('');
	const handleChange = useCallback((event) => setText(event.currentTarget.value), []);

	useEffect(() => {
		setFilter({ text });
	}, [text, setFilter]);

	return <Box mb='x16' is='form' display='flex' flexDirection='column' {...props}>
		<TextInput flexShrink={0} placeholder={t('Search_Users')} addon={<Icon name='magnifier' size='x20'/>} onChange={handleChange} value={text} />
	</Box>;
};

function UserTable({
	workspace = 'local',
}) {
	const [params, setParams] = useState({ current: 0, itemsPerPage: 25 });
	const [sort, setSort] = useState(['name', 'asc']);
	const canViewFullOtherUserInfo = usePermission('view-full-other-user-info');
	const t = useTranslation();

	const federation = workspace === 'external';

	const query = useQuery(params, sort, 'users', workspace);

	const mediaQuery = useMediaQuery('(min-width: 1024px)');

	const onHeaderClick = useCallback((id) => {
		const [sortBy, sortDirection] = sort;

		if (sortBy === id) {
			setSort([id, sortDirection === 'asc' ? 'desc' : 'asc']);
			return;
		}
		setSort([id, 'asc']);
	}, [sort]);

	const header = useMemo(() => [
		<Th key={'name'} direction={sort[1]} active={sort[0] === 'name'} onClick={onHeaderClick} sort='name'>{t('Name')}</Th>,
		mediaQuery && canViewFullOtherUserInfo && <Th key={'email'} direction={sort[1]} active={sort[0] === 'email'} onClick={onHeaderClick} sort='email' style={{ width: '200px' }} >{t('Email')}</Th>,
		federation && <Th key={'origin'} direction={sort[1]} active={sort[0] === 'origin'} onClick={onHeaderClick} sort='origin' style={{ width: '200px' }} >{t('Domain')}</Th>,
		mediaQuery && <Th key={'createdAt'} direction={sort[1]} active={sort[0] === 'createdAt'} onClick={onHeaderClick} sort='createdAt' style={{ width: '200px' }}>{t('Joined_at')}</Th>,
	].filter(Boolean), [sort, onHeaderClick, t, mediaQuery, canViewFullOtherUserInfo, federation]);

	const directRoute = useRoute('direct');

	const data = useEndpointData('directory', query) || {};

	const onClick = useCallback((username) => (e) => {
		if (e.type === 'click' || e.key === 'Enter') {
			directRoute.push({ rid: username });
		}
	}, [directRoute]);


	const formatDate = useFormatDate();

	const renderRow = useCallback(({ createdAt, emails, _id, username, name, domain, bio, avatarETag }) => {
		const avatarUrl = getUserAvatarURL(username, avatarETag);

		return <Table.Row key={_id} onKeyDown={onClick(username)} onClick={onClick(username)} tabIndex={0} role='link' action>
			<Table.Cell>
				<Flex.Container>
					<Box>
						<Flex.Item>
							<Avatar size='x40' title={username} url={avatarUrl} />
						</Flex.Item>
						<Box style={style} grow={1} mi='x8'>
							<Box display='flex'>
								<Box fontScale='p2' style={style}>{name || username}</Box> <Box mi='x4'/> <Box fontScale='p1' color='hint' style={style}>{username}</Box>
							</Box>
							<Box fontScale='p1' color='hint' style={style}> {bio} </Box>
						</Box>
					</Box>
				</Flex.Container>
			</Table.Cell>
			{mediaQuery && canViewFullOtherUserInfo
			&& <Table.Cell style={style} >
				{emails && emails[0].address}
			</Table.Cell>}
			{federation
		&& <Table.Cell style={style}>
			{domain}
		</Table.Cell>}
			{mediaQuery && <Table.Cell fontScale='p1' color='hint' style={style}>
				{formatDate(createdAt)}
			</Table.Cell>}
		</Table.Row>;
	}, [mediaQuery, federation, canViewFullOtherUserInfo, formatDate, onClick]);

	return <GenericTable FilterComponent={FilterByText} header={header} renderRow={renderRow} results={data.result} total={data.total} setParams={setParams} />;
}

export default function UserTab(props) {
	const canViewOutsideRoom = usePermission('view-outside-room');
	const canViewDM = usePermission('view-d-room');

	if (canViewOutsideRoom && canViewDM) {
		return <UserTable {...props} />;
	}

	return <NotAuthorizedPage />;
}
