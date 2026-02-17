import { Controller, Get, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { RegistryService } from './registry.service';
import { UpdateRecordDto } from './dto/update-record.dto';
import { DeleteRecordDto } from './dto/delete-record.dto';

@Controller()
export class RegistryController {
	constructor(private readonly registryService: RegistryService) {}

	/**
	 * GET /resolve/:did
	 * Returns the latest hosting record for a DID.
	 */
	@Get('resolve/:did')
	async resolve(@Param('did') did: string) {
		if (!did.startsWith('did:syr:')) {
			throw new HttpException(
				{ code: 'INVALID_DID', message: 'DID must start with did:syr:' },
				HttpStatus.BAD_REQUEST
			);
		}

		const record = await this.registryService.resolve(did);
		if (!record) {
			throw new HttpException(
				{ code: 'NOT_FOUND', message: 'DID not registered' },
				HttpStatus.NOT_FOUND
			);
		}

		return record;
	}

	/**
	 * POST /update
	 * Submit a signed hosting record to register or update a DID's provider.
	 * The signature is verified against the public key embedded in the DID.
	 */
	@Post('update')
	async update(@Body() dto: UpdateRecordDto) {
		if (!dto.did?.startsWith('did:syr:')) {
			throw new HttpException(
				{ code: 'INVALID_DID', message: 'DID must start with did:syr:' },
				HttpStatus.BAD_REQUEST
			);
		}

		if (!dto.provider || !dto.updatedAt || !dto.signature) {
			throw new HttpException(
				{
					code: 'MISSING_FIELDS',
					message: 'Required fields: did, provider, updatedAt, signature'
				},
				HttpStatus.BAD_REQUEST
			);
		}

		try {
			const result = await this.registryService.update(dto);
			return { status: 'success', data: result };
		} catch (err) {
			if (err instanceof HttpException) throw err;

			const message = err instanceof Error ? err.message : 'Update failed';

			if (message.includes('signature')) {
				throw new HttpException({ code: 'INVALID_SIGNATURE', message }, HttpStatus.BAD_REQUEST);
			}
			if (message.includes('stale') || message.includes('older')) {
				throw new HttpException({ code: 'STALE_UPDATE', message }, HttpStatus.CONFLICT);
			}

			throw new HttpException(
				{ code: 'INTERNAL_ERROR', message },
				HttpStatus.INTERNAL_SERVER_ERROR
			);
		}
	}

	/**
	 * POST /delete
	 * Submit a signed deletion request to remove a DID's hosting record.
	 * The signature is verified against the public key embedded in the DID.
	 */
	@Post('delete')
	async delete(@Body() dto: DeleteRecordDto) {
		if (!dto.did?.startsWith('did:syr:')) {
			throw new HttpException(
				{ code: 'INVALID_DID', message: 'DID must start with did:syr:' },
				HttpStatus.BAD_REQUEST
			);
		}

		if (!dto.deletedAt || !dto.signature) {
			throw new HttpException(
				{
					code: 'MISSING_FIELDS',
					message: 'Required fields: did, deletedAt, signature'
				},
				HttpStatus.BAD_REQUEST
			);
		}

		try {
			await this.registryService.delete(dto);
			return { status: 'success', message: 'Hosting record deleted' };
		} catch (err) {
			if (err instanceof HttpException) throw err;

			const message = err instanceof Error ? err.message : 'Delete failed';

			if (message.includes('signature')) {
				throw new HttpException({ code: 'INVALID_SIGNATURE', message }, HttpStatus.BAD_REQUEST);
			}
			if (message.includes('not found') || message.includes('Not found')) {
				throw new HttpException({ code: 'NOT_FOUND', message }, HttpStatus.NOT_FOUND);
			}

			throw new HttpException(
				{ code: 'INTERNAL_ERROR', message },
				HttpStatus.INTERNAL_SERVER_ERROR
			);
		}
	}

	/**
	 * GET /health
	 * Health check endpoint.
	 */
	@Get('health')
	health() {
		return { status: 'ok', service: 'syr-registry-api' };
	}
}
