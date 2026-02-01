/**
 * Tunnels Page (Channels)
 * Connectivity management
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Badge, Button, Skeleton } from '../components/base';
import { getChannels } from '../api/client';
import { QRCodeSVG } from 'qrcode.react';

interface ChannelStatus {
  id: string;
  status: {
    connected: boolean;
    selfJid?: string;
    qr?: string;
    message?: string;
    [key: string]: any;
  };
}

export const Tunnels: React.FC = () => {
    const [channels, setChannels] = useState<ChannelStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchChannels = useCallback(async () => {
        try {
            const data = await getChannels();
            if (data.ok) {
                setChannels(data.channels);
            }
        } catch (err) {
            console.error('Failed to fetch channels:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchChannels();
        // Poll for QR updates
        const interval = setInterval(fetchChannels, 2000);
        return () => clearInterval(interval);
    }, [fetchChannels]);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchChannels();
    };

    if (loading) {
        return (
            <div className="p-6 space-y-4">
                <Skeleton variant="rectangular" height={120} />
                <Skeleton variant="rectangular" height={120} />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <header className="flex items-center justify-between p-4 border-b border-chamber-wall">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <span className="text-3xl">📡</span>
                        Tunnels
                    </h1>
                    <p className="text-sm text-gray-400">Communication Channels</p>
                </div>
                <Button variant="secondary" onClick={handleRefresh} loading={refreshing}>
                    Refresh Status
                </Button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {channels.map((channel) => (
                        <Card key={channel.id} className="flex flex-col gap-4">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <span className="text-3xl">
                                        {channel.id === 'whatsapp' ? '📱' :
                                         channel.id === 'cli' ? '💻' :
                                         channel.id === 'web' ? '🌐' : '🔌'}
                                    </span>
                                    <div>
                                        <h3 className="font-bold text-white capitalize">{channel.id}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`w-2 h-2 rounded-full ${channel.status.connected ? 'bg-nurse-green' : 'bg-soldier-rust'}`} />
                                            <span className="text-xs text-gray-400">
                                                {channel.status.connected ? 'Connected' : 'Disconnected'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <Badge variant={channel.status.connected ? 'nurse' : 'default'}>
                                    {channel.status.connected ? 'Active' : 'Offline'}
                                </Badge>
                            </div>

                            {channel.status.message && (
                                <div className="bg-chamber-wall/30 p-2 rounded text-xs text-gray-400">
                                    {channel.status.message}
                                </div>
                            )}

                            {channel.id === 'whatsapp' && (
                                <div className="mt-2 border-t border-chamber-wall pt-4">
                                    {channel.status.qr ? (
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="bg-white p-4 rounded-lg">
                                                <QRCodeSVG value={channel.status.qr} size={160} />
                                            </div>
                                            <p className="text-sm text-center text-queen-amber">
                                                Scan to connect WhatsApp
                                            </p>
                                        </div>
                                    ) : (
                                        channel.status.selfJid && (
                                            <div className="text-sm text-gray-400 wrap-words">
                                                Connected as: <span className="text-white font-mono">{channel.status.selfJid}</span>
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                        </Card>
                    ))}

                    {channels.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center p-12 text-gray-500">
                            <span className="text-4xl mb-4">🔇</span>
                            <p>No active tunnels found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
