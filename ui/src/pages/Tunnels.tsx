/**
 * Tunnels Page (Channels)
 * Connectivity management
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Badge, Button, Skeleton, Modal } from '../components/base';
import { getChannels, getTelegramPairing, approveTelegramPairing, denyTelegramPairing, removeTelegramAllowFrom, type TelegramPairingSnapshotResponse } from '../api/client';
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
    const [telegramModalOpen, setTelegramModalOpen] = useState(false);
    const [telegramPairing, setTelegramPairing] = useState<TelegramPairingSnapshotResponse | null>(null);
    const [telegramPairingLoading, setTelegramPairingLoading] = useState(false);
    const [telegramActionBusy, setTelegramActionBusy] = useState<string | null>(null);

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

    const fetchTelegramPairing = useCallback(async () => {
        setTelegramPairingLoading(true);
        try {
            const data = await getTelegramPairing();
            if (data.ok) setTelegramPairing(data);
        } catch (err) {
            console.error('Failed to fetch Telegram pairing:', err);
        } finally {
            setTelegramPairingLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!telegramModalOpen) return;
        fetchTelegramPairing();
    }, [telegramModalOpen, fetchTelegramPairing]);

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
                                         channel.id === 'telegram' ? '✈️' :
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

                            {channel.id === 'telegram' && (
                                <div className="mt-2 border-t border-chamber-wall pt-4 flex flex-col gap-4">
                                    {channel.status.qr ? (
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="bg-white p-4 rounded-lg">
                                                <QRCodeSVG value={channel.status.qr} size={160} />
                                            </div>
                                            <p className="text-sm text-center text-queen-amber">
                                                Scan to open Telegram bot
                                            </p>
                                            {channel.status.selfUsername && (
                                                <div className="text-xs text-gray-400">
                                                    @{channel.status.selfUsername}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-400">
                                            {channel.status.configured ? (
                                                <span>Telegram configured. Waiting for connection…</span>
                                            ) : (
                                                <span>
                                                    Telegram not configured. Set <span className="font-mono text-white">telegram.enabled</span> and <span className="font-mono text-white">telegram.botToken</span>.
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-2 text-xs text-gray-400">
                                        {typeof channel.status.dmPolicy === 'string' && (
                                            <div>
                                                DM policy: <span className="text-white font-mono">{channel.status.dmPolicy}</span>
                                            </div>
                                        )}
                                        <div className="text-gray-500">
                                            Tip: users can send <span className="font-mono text-white">/pair</span> to request access, then approve in this UI.
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <Button
                                            variant="secondary"
                                            onClick={() => setTelegramModalOpen(true)}
                                        >
                                            Pairing
                                        </Button>
                                    </div>
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

            <Modal
                isOpen={telegramModalOpen}
                onClose={() => setTelegramModalOpen(false)}
                title="Telegram Pairing"
                size="lg"
            >
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-400">
                            Approve pairing codes requested via <span className="font-mono text-white">/pair</span>.
                        </div>
                        <Button variant="secondary" onClick={fetchTelegramPairing} loading={telegramPairingLoading}>
                            Refresh
                        </Button>
                    </div>

                    {/* Pending requests */}
                    <div className="border border-chamber-wall rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-chamber-wall/30 text-xs text-gray-400">
                            Pending Requests ({telegramPairing?.requests?.length ?? 0})
                        </div>
                        <div className="p-3 flex flex-col gap-3">
                            {(telegramPairing?.requests ?? []).length === 0 ? (
                                <div className="text-sm text-gray-500">No pending requests.</div>
                            ) : (
                                (telegramPairing?.requests ?? []).map((req) => (
                                    <div key={req.id} className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm text-white font-mono">{req.code}</div>
                                            <div className="text-xs text-gray-400 truncate">
                                                {req.username ? `${req.username} · ` : ''}userId {req.userId}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 flex-shrink-0">
                                            <Button
                                                variant="primary"
                                                loading={telegramActionBusy === `approve:${req.code}`}
                                                onClick={async () => {
                                                    setTelegramActionBusy(`approve:${req.code}`);
                                                    try {
                                                        await approveTelegramPairing(req.code);
                                                        await fetchTelegramPairing();
                                                    } finally {
                                                        setTelegramActionBusy(null);
                                                    }
                                                }}
                                            >
                                                Approve
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                loading={telegramActionBusy === `deny:${req.code}`}
                                                onClick={async () => {
                                                    setTelegramActionBusy(`deny:${req.code}`);
                                                    try {
                                                        await denyTelegramPairing(req.code);
                                                        await fetchTelegramPairing();
                                                    } finally {
                                                        setTelegramActionBusy(null);
                                                    }
                                                }}
                                            >
                                                Deny
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Allowlist */}
                    <div className="border border-chamber-wall rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-chamber-wall/30 text-xs text-gray-400">
                            Allowlist ({telegramPairing?.allowFrom?.length ?? 0})
                        </div>
                        <div className="p-3 flex flex-col gap-2">
                            {(telegramPairing?.allowFrom ?? []).length === 0 ? (
                                <div className="text-sm text-gray-500">No allowlist entries.</div>
                            ) : (
                                (telegramPairing?.allowFrom ?? []).map((entry) => (
                                    <div key={entry} className="flex items-center justify-between gap-3">
                                        <div className="text-sm text-white font-mono truncate">{entry}</div>
                                        <Button
                                            variant="secondary"
                                            loading={telegramActionBusy === `remove:${entry}`}
                                            onClick={async () => {
                                                setTelegramActionBusy(`remove:${entry}`);
                                                try {
                                                    await removeTelegramAllowFrom(entry);
                                                    await fetchTelegramPairing();
                                                } finally {
                                                    setTelegramActionBusy(null);
                                                }
                                            }}
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};
