import { Box, Table, Avatar, TextInput, Icon } from '@rocket.chat/fuselage';
import { useDebouncedValue, useMediaQuery } from '@rocket.chat/fuselage-hooks';
import React, { useMemo, useCallback, useState, useEffect } from 'react';

import { GenericTable, Th } from '../../components/GenericTable';
import { useTranslation } from '../../contexts/TranslationContext';
import { getUserAvatarURL } from '../../../app/utils/client';
import { useRoute } from '../../contexts/RouterContext';
import { useEndpointData } from '../../hooks/useEndpointData';

const style = { whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' };

const FilterByText = ({ setFilter, ...props }) => {
	const t = useTranslation();
	const [text, setText] = useState('');
	const handleChange = useCallback((event) => setText(event.currentTarget.value), []);

	useEffect(() => {
		setFilter({ text });
	}, [setFilter, text]);
	return <Box mb='x16' is='form' onSubmit={useCallback((e) => e.preventDefault(), [])} display='flex' flexDirection='column' {...props}>
		<TextInput flexShrink={0} placeholder={t('Search_Users')} addon={<Icon name='magnifier' size='x20'/>} onChange={handleChange} value={text} />
	</Box>;
};

const sortDir = (sortDir) => (sortDir === 'asc' ? 1 : -1);

const useQuery = ({ text, itemsPerPage, current }, [column, direction]) => useMemo(() => ({
	fields: JSON.stringify({ name: 1, username: 1, emails: 1, roles: 1, status: 1, avatarETag: 1 }),
	query: JSON.stringify({
		$or: [
			{ 'emails.address': { $regex: text || '', $options: 'i' } },
			{ username: { $regex: text || '', $options: 'i' } },
			{ name: { $regex: text || '', $options: 'i' } },
		],
	}),
	sort: JSON.stringify({ [column]: sortDir(direction), usernames: column === 'name' ? sortDir(direction) : undefined }),
	...itemsPerPage && { count: itemsPerPage },
	...current && { offset: current },
}), [text, itemsPerPage, current, column, direction]);

export function UsersTable() {
	const t = useTranslation();

	const [params, setParams] = useState({ text: '', current: 0, itemsPerPage: 25 });
	const [sort, setSort] = useState(['name', 'asc']);

	const debouncedParams = useDebouncedValue(params, 500);
	const debouncedSort = useDebouncedValue(sort, 500);
	const query = useQuery(debouncedParams, debouncedSort);

	const data = useEndpointData('users.list', query) || {};

	const usersRoute = useRoute('admin-users');

	const onClick = useCallback((username) => () => usersRoute.push({
		context: 'info',
		id: username,
	}), [usersRoute]);

	const onHeaderClick = useCallback((id) => {
		const [sortBy, sortDirection] = sort;

		if (sortBy === id) {
			setSort([id, sortDirection === 'asc' ? 'desc' : 'asc']);
			return;
		}
		setSort([id, 'asc']);
	}, [sort]);

	const mediaQuery = useMediaQuery('(min-width: 1024px)');

	const header = useMemo(() => [
		<Th key={'name'} direction={sort[1]} active={sort[0] === 'name'} onClick={onHeaderClick} sort='name' w='x200'>{t('Name')}</Th>,
		mediaQuery && <Th key={'username'} direction={sort[1]} active={sort[0] === 'username'} onClick={onHeaderClick} sort='username' w='x140'>{t('Username')}</Th>,
		<Th key={'email'} direction={sort[1]} active={sort[0] === 'emails.adress'} onClick={onHeaderClick} sort='emails.address' w='x120'>{t('Email')}</Th>,
		mediaQuery && <Th key={'roles'} direction={sort[1]} active={sort[0] === 'roles'} onClick={onHeaderClick} sort='roles' w='x120'>{t('Roles')}</Th>,
		<Th key={'status'} direction={sort[1]} active={sort[0] === 'status'} onClick={onHeaderClick} sort='status' w='x100'>{t('Status')}</Th>,
	].filter(Boolean), [sort, onHeaderClick, t, mediaQuery]);

	const renderRow = useCallback(({ emails, _id, username, name, roles, status, avatarETag }) => {
		const avatarUrl = getUserAvatarURL(username, avatarETag);

		return <Table.Row key={_id} onKeyDown={onClick(_id)} onClick={onClick(_id)} tabIndex={0} role='link' action qa-user-id={_id}>
			<Table.Cell style={style}>
				<Box display='flex' alignItems='center'>
					<Avatar size={mediaQuery ? 'x28' : 'x40'} title={username} url={avatarUrl} />
					<Box display='flex' style={style} mi='x8'>
						<Box display='flex' flexDirection='column' alignSelf='center' style={style}>
							<Box fontScale='p2' style={style} color='default'>{name || username}</Box>
							{!mediaQuery && name && <Box fontScale='p1' color='hint' style={style}> {`@${ username }`} </Box>}
						</Box>
					</Box>
				</Box>
			</Table.Cell>
			{mediaQuery && <Table.Cell>
				<Box fontScale='p2' style={style} color='hint'>{ username }</Box> <Box mi='x4'/>
			</Table.Cell>}
			<Table.Cell style={style}>{emails && emails.length && emails[0].address}</Table.Cell>
			{mediaQuery && <Table.Cell style={style}>{roles && roles.join(', ')}</Table.Cell>}
			<Table.Cell fontScale='p1' color='hint' style={style}>{status}</Table.Cell>
		</Table.Row>;
	}, [mediaQuery, onClick]);

	return <GenericTable FilterComponent={FilterByText} header={header} renderRow={renderRow} results={data.users} total={data.total} setParams={setParams} params={params} />;
}

export default UsersTable;
