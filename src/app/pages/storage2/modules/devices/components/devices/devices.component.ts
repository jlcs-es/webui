import { NestedTreeControl } from '@angular/cdk/tree';
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import _ from 'lodash';
import { EMPTY } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { VDevType } from 'app/enums/v-dev-type.enum';
import { DeviceNestedDataNode } from 'app/interfaces/device-nested-data-node.interface';
import { PoolTopology } from 'app/interfaces/pool.interface';
import { Disk } from 'app/interfaces/storage.interface';
import { IxNestedTreeDataSource } from 'app/modules/ix-tree/ix-nested-tree-datasource';
import { findInTree } from 'app/modules/ix-tree/utils/find-in-tree.utils';
import { DevicesStore } from 'app/pages/storage2/modules/devices/stores/devices-store.service';
import { AppLoaderService, WebSocketService } from 'app/services';

@UntilDestroy()
@Component({
  templateUrl: './devices.component.html',
  styleUrls: ['./devices.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicesComponent implements OnInit {
  topology: PoolTopology;
  selectedItem: DeviceNestedDataNode;
  selectedParentItem: DeviceNestedDataNode | undefined;
  dataSource: IxNestedTreeDataSource<DeviceNestedDataNode>;
  treeControl = new NestedTreeControl<DeviceNestedDataNode, string>((vdev) => vdev.children, {
    trackBy: (vdev) => vdev.guid,
  });
  diskDictionary: { [key: string]: Disk } = {};

  readonly hasNestedChild = (_: number, vdev: DeviceNestedDataNode): boolean => Boolean(vdev.children?.length);

  constructor(
    private ws: WebSocketService,
    private cdr: ChangeDetectorRef,
    private loader: AppLoaderService, // TODO: Replace with a better approach
    private route: ActivatedRoute,
    private devicesStore: DevicesStore,
  ) { }

  get isDiskSelected(): boolean {
    return this.selectedItem.type === VDevType.Disk;
  }

  ngOnInit(): void {
    this.loadTopologyAndDisks();

    this.devicesStore.onReloadList
      .pipe(untilDestroyed(this))
      .subscribe(() => this.loadTopologyAndDisks());
  }

  private createDataSource(dataNodes: DeviceNestedDataNode[]): void {
    this.dataSource = new IxNestedTreeDataSource(dataNodes);
    this.dataSource.filterPredicate = (dataNodes, query = '') => {
      return dataNodes.map((dataNode) => {
        return findInTree([dataNode], (dataNode) => {
          switch (dataNode.type) {
            case VDevType.Disk:
              return dataNode.disk?.toLowerCase().includes(query.toLowerCase());
            case VDevType.Mirror:
              return dataNode.name?.toLowerCase().includes(query.toLowerCase());
          }
        });
      }).filter(Boolean);
    };
  }

  private createDataNodes(topology: PoolTopology): DeviceNestedDataNode[] {
    const dataNodes: DeviceNestedDataNode[] = [];
    if (topology.data.length) {
      dataNodes.push({ children: topology.data, disk: 'Data VDEVs', guid: 'data' } as DeviceNestedDataNode);
    }
    if (topology.cache.length) {
      dataNodes.push({ children: topology.cache, disk: 'Cache', guid: 'cache' } as DeviceNestedDataNode);
    }
    if (topology.log.length) {
      dataNodes.push({ children: topology.log, disk: 'Log', guid: 'log' } as DeviceNestedDataNode);
    }
    if (topology.spare.length) {
      dataNodes.push({ children: topology.spare, disk: 'Spare', guid: 'spare' } as DeviceNestedDataNode);
    }
    if (topology.special.length) {
      dataNodes.push({ children: topology.special, disk: 'Metadata', guid: 'special' } as DeviceNestedDataNode);
    }
    if (topology.dedup.length) {
      dataNodes.push({ children: topology.dedup, disk: 'Dedup', guid: 'dedup' } as DeviceNestedDataNode);
    }
    return dataNodes;
  }

  private selectFirstNode(): void {
    if (!this.treeControl?.dataNodes?.length) {
      return;
    }

    const dataNode = this.treeControl.dataNodes[0];
    this.treeControl.expand(dataNode);
    this.selectedItem = dataNode;
    this.selectedParentItem = undefined;
  }

  onRowSelected(dataNodeSelected: DeviceNestedDataNode, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedItem = dataNodeSelected;
    this.selectedParentItem = findInTree(this.treeControl.dataNodes, (dataNode: DeviceNestedDataNode) => {
      return dataNode.guid === dataNodeSelected.guid;
    });
  }

  onSearch(query: string): void {
    this.dataSource.filter(query);
  }

  private loadTopologyAndDisks(): void {
    this.loader.open();
    const poolId = Number(this.route.snapshot.paramMap.get('poolId'));
    this.ws.call('pool.query', [[['id', '=', poolId]]]).pipe(
      switchMap((pools) => {
        // TODO: Handle pool not found.
        return this.ws.call('disk.query', [[['pool', '=', pools[0].name]], { extra: { pools: true } }]).pipe(
          tap((disks) => {
            this.diskDictionary = _.keyBy(disks, (disk) => disk.devname);
            this.topology = pools[0].topology;
            const dataNodes = this.createDataNodes(pools[0].topology);
            this.treeControl.dataNodes = dataNodes;
            this.createDataSource(dataNodes);
            this.selectFirstNode();
            this.loader.close();
            this.cdr.markForCheck();
          }),
        );
      }),
      catchError(() => {
        // TODO: Handle error.
        return EMPTY;
      }),
      untilDestroyed(this),
    )
      .subscribe();
  }
}
