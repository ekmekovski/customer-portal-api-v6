const express = require('express');
const { pool } = require('../../config/database'); // Import the shared pool
const { uploadDocument } = require('../utils/s3');

const router = express.Router();

/**
 * GET /api/clients
 * Get list of all clients
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT id, company_name, contact_email, created_at FROM clients';
    let params = [];

    if (search) {
      query += ' WHERE company_name ILIKE $1 OR contact_email ILIKE $1';
      params.push(`%${search}%`);
      query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
      params.push(limit, offset);
    }

    const result = await pool.query(query, params);

    res.status(200).json({
      clients: result.rows,
      page: parseInt(page),
      limit: parseInt(limit),
      total: result.rowCount
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

/**
 * GET /api/clients/:id
 * Get specific client details
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM clients WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

/**
 * POST /api/clients
 * Create a new client
 */
router.post('/', async (req, res) => {
  try {
    const {
      companyName,
      contactEmail,
      contactPhone,
      address,
      billingAddress
    } = req.body;

    // Validation
    if (!companyName || !contactEmail) {
      return res.status(400).json({ 
        error: 'Company name and contact email are required' 
      });
    }

    const result = await pool.query(
      `INSERT INTO clients 
       (company_name, contact_email, contact_phone, address, billing_address, created_at) 
       VALUES ($1, $2, $3, $4, $5, NOW()) 
       RETURNING *`,
      [companyName, contactEmail, contactPhone, address, billingAddress]
    );

    res.status(201).json({
      message: 'Client created successfully',
      client: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

/**
 * PUT /api/clients/:id
 * Update client information
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      companyName,
      contactEmail,
      contactPhone,
      address,
      billingAddress
    } = req.body;

    const result = await pool.query(
      `UPDATE clients 
       SET company_name = $1, contact_email = $2, contact_phone = $3, 
           address = $4, billing_address = $5, updated_at = NOW()
       WHERE id = $6 
       RETURNING *`,
      [companyName, contactEmail, contactPhone, address, billingAddress, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.status(200).json({
      message: 'Client updated successfully',
      client: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

/**
 * DELETE /api/clients/:id
 * Delete a client
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM clients WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.status(200).json({
      message: 'Client deleted successfully',
      client: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

/**
 * POST /api/clients/:id/documents
 * Upload document for a client
 */
router.post('/:id/documents', async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.files?.document;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check if client exists
    const clientResult = await pool.query(
      'SELECT id FROM clients WHERE id = $1',
      [id]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Upload to S3
    const documentUrl = await uploadDocument(file, id);

    // Save document reference in database
    await pool.query(
      `INSERT INTO client_documents (client_id, filename, url, uploaded_at) 
       VALUES ($1, $2, $3, NOW())`,
      [id, file.name, documentUrl]
    );

    res.status(201).json({
      message: 'Document uploaded successfully',
      url: documentUrl
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * GET /api/clients/:id/transactions
 * Get client transaction history
 */
router.get('/:id/transactions', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT t.*, p.payment_method 
       FROM transactions t
       LEFT JOIN payments p ON t.payment_id = p.id
       WHERE t.client_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.status(200).json({
      transactions: result.rows,
      clientId: id
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;