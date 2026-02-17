import { Controller, Get, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import { UpdateRecordDto } from './dto/update-record.dto';
import { DeleteRecordDto } from './dto/delete-record.dto';

@ApiTags('registry')
@Controller()
export class RegistryController {
	constructor(private readonly registryService: RegistryService) {}

	/**
	 * GET /resolve/:did
	 * Returns the latest hosting record for a DID.
	 */
	@Get('resolve/:did')
	@ApiOperation({ summary: 'Resolve DID', description: 'Returns the latest hosting record for a DID.' })
	@ApiParam({ name: 'did', example: 'did:syr:z6Mk...' })
	@ApiResponse({ status: 200, description: 'Hosting record found' })
	@ApiResponse({ status: 400, description: 'Invalid DID format' })
	@ApiResponse({ status: 404, description: 'DID not registered' })
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
	@ApiOperation({
		summary: 'Update hosting record',
		description:
			'Submit a signed hosting record to register or update a DID\'s provider. Signature is verified against the public key embedded in the DID.'
	})
	@ApiBody({ type: UpdateRecordDto })
	@ApiResponse({ status: 200, description: 'Record updated successfully' })
	@ApiResponse({ status: 400, description: 'Invalid DID or missing fields' })
	@ApiResponse({ status: 409, description: 'Stale update (older timestamp)' })
	async update(@Body() dto: UpdateRecordDto) {
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
	@ApiOperation({
		summary: 'Delete hosting record',
		description:
			'Submit a signed deletion request to remove a DID\'s hosting record. Signature is verified against the public key embedded in the DID.'
	})
	@ApiBody({ type: DeleteRecordDto })
	@ApiResponse({ status: 200, description: 'Record deleted successfully' })
	@ApiResponse({ status: 400, description: 'Invalid DID or missing fields' })
	@ApiResponse({ status: 404, description: 'DID not found' })
	async delete(@Body() dto: DeleteRecordDto) {
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
	@ApiOperation({ summary: 'Health check', description: 'Returns service status.' })
	@ApiResponse({ status: 200, description: 'Service OK' })
	health() {
		return { status: 'ok', service: 'syr-registry-api' };
	}
}
