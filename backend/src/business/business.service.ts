import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { business } from '../database/schema';

@Injectable()
export class BusinessService {
  constructor(private readonly database: DatabaseService) {}

  async getBusinessProfile(businessId: string) {
    const [profile] = await this.database
      .select({
        id: business.id,
        legalName: business.legalName,
        displayName: business.displayName,
        address: business.address,
        addressDetails: business.addressDetails,
        primaryContactNumber: business.primaryContactNumber,
        primaryContactEmail: business.primaryContactEmail,
        isActive: business.isActive,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      })
      .from(business)
      .where(eq(business.id, businessId))
      .limit(1);

    if (!profile) throw new NotFoundException('Business was not found');
    return profile;
  }
}
