import { useState, useEffect } from 'react';

interface ServicePublic {
    id: number;
    serviceName: string;
    monitorEndpoint: string;
    scaleEndpoint: string;
    rollbackEndpoint: string;
    status: 'pending' | 'approved' | 'rejected';
    registeredAt: string;
}

const API_BASE = 'http://localhost:3001/api';

function Admin() {
    const [services, setServices] = useState<ServicePublic[]>([]);
    const [formData, setFormData] = useState({
        serviceName: '',
        monitorEndpoint: '',
        scaleEndpoint: '',
        rollbackEndpoint: '',
        apiKey: '',
    });
    const [registering, setRegistering] = useState(false);

    useEffect(() => {
        const fetchServices = async () => {
            try {
                const res = await fetch(`${API_BASE}/services`);
                const data = await res.json();
                setServices(data);
            } catch (err) {
                console.error('Failed to fetch services:', err);
            }
        };

        fetchServices();
        const interval = setInterval(fetchServices, 3000);
        return () => clearInterval(interval);
    }, []);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setRegistering(true);

        try {
            const res = await fetch(`${API_BASE}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            const data = await res.json();

            if (res.ok) {
                alert('Service registered (pending approval)');
                setFormData({
                    serviceName: '',
                    monitorEndpoint: '',
                    scaleEndpoint: '',
                    rollbackEndpoint: '',
                    apiKey: '',
                });
            } else {
                alert(`Registration failed: ${data.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Failed to register service:', err);
            alert('Registration failed');
        } finally {
            setRegistering(false);
        }
    };

    const handleApprove = async (id: number) => {
        try {
            const res = await fetch(`${API_BASE}/services/${id}/approve`, {
                method: 'POST',
            });
            if (res.ok) {
                alert('Service approved');
            } else {
                alert('Failed to approve service');
            }
        } catch (err) {
            console.error('Failed to approve:', err);
            alert('Approval failed');
        }
    };

    const handleReject = async (id: number) => {
        try {
            const res = await fetch(`${API_BASE}/services/${id}/reject`, {
                method: 'POST',
            });
            if (res.ok) {
                alert('Service rejected');
            } else {
                alert('Failed to reject service');
            }
        } catch (err) {
            console.error('Failed to reject:', err);
            alert('Rejection failed');
        }
    };

    const pendingServices = services.filter((s) => s.status === 'pending');
    const approvedService = services.find((s) => s.status === 'approved');

    return (
        <div className="admin-page">
            <h2>Service Registration</h2>

            <form className="registration-form" onSubmit={handleRegister}>
                <div className="form-group">
                    <label>Service Name</label>
                    <input
                        type="text"
                        value={formData.serviceName}
                        onChange={(e) =>
                            setFormData({ ...formData, serviceName: e.target.value })
                        }
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Monitor Endpoint URL</label>
                    <input
                        type="url"
                        placeholder="http://example.com/monitor"
                        value={formData.monitorEndpoint}
                        onChange={(e) =>
                            setFormData({ ...formData, monitorEndpoint: e.target.value })
                        }
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Scale Endpoint URL</label>
                    <input
                        type="url"
                        placeholder="http://example.com/scale"
                        value={formData.scaleEndpoint}
                        onChange={(e) =>
                            setFormData({ ...formData, scaleEndpoint: e.target.value })
                        }
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Rollback Endpoint URL</label>
                    <input
                        type="url"
                        placeholder="http://example.com/rollback"
                        value={formData.rollbackEndpoint}
                        onChange={(e) =>
                            setFormData({ ...formData, rollbackEndpoint: e.target.value })
                        }
                        required
                    />
                </div>

                <div className="form-group">
                    <label>API Key</label>
                    <input
                        type="password"
                        value={formData.apiKey}
                        onChange={(e) =>
                            setFormData({ ...formData, apiKey: e.target.value })
                        }
                        required
                    />
                </div>

                <button type="submit" disabled={registering} className="submit-btn">
                    {registering ? 'Registering...' : 'Register Service'}
                </button>
            </form>

            <h2>Active Service</h2>
            {approvedService ? (
                <div className="service-card approved">
                    <div className="service-header">
                        <span className="service-name">✅ {approvedService.serviceName}</span>
                        <span className="service-status">APPROVED</span>
                    </div>
                    <div className="service-endpoints">
                        <div>
                            <strong>Monitor:</strong> {approvedService.monitorEndpoint}
                        </div>
                        <div>
                            <strong>Scale:</strong> {approvedService.scaleEndpoint}
                        </div>
                        <div>
                            <strong>Rollback:</strong> {approvedService.rollbackEndpoint}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="no-service">No approved service</div>
            )}

            <h2>Pending Approvals ({pendingServices.length})</h2>
            {pendingServices.length === 0 ? (
                <div className="no-service">No pending services</div>
            ) : (
                <div className="service-list">
                    {pendingServices.map((service) => (
                        <div key={service.id} className="service-card pending">
                            <div className="service-header">
                                <span className="service-name">⏳ {service.serviceName}</span>
                                <span className="service-status">PENDING</span>
                            </div>
                            <div className="service-endpoints">
                                <div>
                                    <strong>Monitor:</strong> {service.monitorEndpoint}
                                </div>
                                <div>
                                    <strong>Scale:</strong> {service.scaleEndpoint}
                                </div>
                                <div>
                                    <strong>Rollback:</strong> {service.rollbackEndpoint}
                                </div>
                            </div>
                            <div className="service-actions">
                                <button
                                    onClick={() => handleApprove(service.id)}
                                    className="approve-btn"
                                >
                                    ✅ Approve
                                </button>
                                <button
                                    onClick={() => handleReject(service.id)}
                                    className="reject-btn"
                                >
                                    ❌ Reject
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default Admin;
