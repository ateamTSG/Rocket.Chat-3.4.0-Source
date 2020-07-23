import {
	AbstractBusinessHourType,
	IBusinessHourType,
} from '../../../../../app/livechat/server/business-hour/AbstractBusinessHour';
import { ILivechatBusinessHour, LivechatBusinessHourTypes } from '../../../../../definition/ILivechatBusinessHour';
import { LivechatDepartmentRaw } from '../../../../../app/models/server/raw/LivechatDepartment';
import { LivechatDepartment } from '../../../../../app/models/server/raw';
import { businessHourManager } from '../../../../../app/livechat/server/business-hour';
import LivechatDepartmentAgents, { LivechatDepartmentAgentsRaw } from '../../../models/server/raw/LivechatDepartmentAgents';

export interface IBusinessHoursExtraProperties extends ILivechatBusinessHour {
	timezoneName: string;
	departmentsToApplyBusinessHour: string;
}

class CustomBusinessHour extends AbstractBusinessHourType implements IBusinessHourType {
	name = LivechatBusinessHourTypes.CUSTOM;

	private DepartmentsRepository: LivechatDepartmentRaw = LivechatDepartment;

	private DepartmentsAgentsRepository: LivechatDepartmentAgentsRaw = LivechatDepartmentAgents;

	async getBusinessHour(id: string): Promise<ILivechatBusinessHour | undefined> {
		if (!id) {
			return;
		}
		const businessHour: ILivechatBusinessHour = await this.BusinessHourRepository.findOneById(id);
		businessHour.departments = await this.DepartmentsRepository.findByBusinessHourId(businessHour._id, { fields: { name: 1 } }).toArray();
		return businessHour;
	}

	async saveBusinessHour(businessHourData: IBusinessHoursExtraProperties): Promise<ILivechatBusinessHour> {
		businessHourData.timezone = {
			name: businessHourData.timezoneName,
			utc: this.getUTCFromTimezone(businessHourData.timezoneName),
		};
		const departments = businessHourData.departmentsToApplyBusinessHour?.split(',').filter(Boolean);
		const businessHourToReturn = { ...businessHourData };
		delete businessHourData.timezoneName;
		delete businessHourData.departmentsToApplyBusinessHour;
		delete businessHourData.departments;
		const businessHourId = await this.baseSaveBusinessHour(businessHourData);
		const currentDepartments = (await this.DepartmentsRepository.findByBusinessHourId(businessHourId, { fields: { _id: 1 } }).toArray()).map((dept: any) => dept._id);
		const toRemove = [...currentDepartments.filter((dept: string) => !departments.includes(dept))];
		const toAdd = [...departments.filter((dept: string) => !currentDepartments.includes(dept))];
		await this.removeBusinessHourFromDepartmentsIfNeeded(businessHourId, toRemove);
		await this.addBusinessHourToDepartmentsIfNeeded(businessHourId, toAdd);
		businessHourToReturn._id = businessHourId;
		return businessHourToReturn;
	}

	async removeBusinessHourById(businessHourId: string): Promise<void> {
		const businessHour = await this.BusinessHourRepository.findOneById(businessHourId, {});
		if (!businessHour) {
			return;
		}
		await this.BusinessHourRepository.removeById(businessHourId);
		await this.removeBusinessHourFromAgents(businessHourId);
		await this.DepartmentsRepository.removeBusinessHourFromDepartmentsByBusinessHourId(businessHourId);
		return this.UsersRepository.updateLivechatStatusBasedOnBusinessHours();
	}

	private async removeBusinessHourFromAgents(businessHourId: string): Promise<void> {
		const departmentIds = (await this.DepartmentsRepository.findByBusinessHourId(businessHourId, { fields: { _id: 1 } }).toArray()).map((dept: any) => dept._id);
		const agentIds = (await this.DepartmentsAgentsRepository.findByDepartmentIds(departmentIds, { fields: { agentId: 1 } }).toArray()).map((dept: any) => dept.agentId);
		return this.UsersRepository.removeBusinessHourByAgentIds(agentIds, businessHourId);
	}

	private async removeBusinessHourFromDepartmentsIfNeeded(businessHourId: string, departmentsToRemove: string[]): Promise<void> {
		if (!departmentsToRemove.length) {
			return;
		}
		await this.DepartmentsRepository.removeBusinessHourFromDepartmentsByIdsAndBusinessHourId(departmentsToRemove, businessHourId);
	}

	private async addBusinessHourToDepartmentsIfNeeded(businessHourId: string, departmentsToAdd: string[]): Promise<void> {
		if (!departmentsToAdd.length) {
			return;
		}
		await this.DepartmentsRepository.addBusinessHourToDepartamentsByIds(departmentsToAdd, businessHourId);
	}
}

businessHourManager.registerBusinessHourType(new CustomBusinessHour());
